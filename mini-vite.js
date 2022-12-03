const Koa = require('koa')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
//单文件处理是使用的是@vue/compiler-sfc模块进行编译处理的
const compilerSfc = require('@vue/compiler-sfc')
//处理模版的编译
const compilerDom = require('@vue/compiler-dom')

const app = new Koa()

// 获取文件的最后修改时间
const getFileUpdatedDate = (path) => {
  const stats = fs.statSync(path)
  // console.log(stats)
  return stats.mtime
}
// 协商缓存判断返回304还是200
const ifUseCache = (ctx, url, ifNoneMatch, ifModifiedSince) => {
  //console.log('url', url)
  //console.log('ifNoneMatch', ifNoneMatch)
  //console.log('ifModifiedSince', ifModifiedSince)
  let flag = false
  // 使用协商缓存
  ctx.set('Cache-Control', 'no-cache')
  // 设置过期时间在30000毫秒，也就是30秒后
  //ctx.set('Expires', new Date(Date.now() + 30000))
  ctx.set(
    'Expires',
    Buffer.from(new Date(Date.now() + 10000)).toString('base64')
  )
  let filePath = url.includes('.vue') ? url : path.join(__dirname, url)
  //console.log('filePath', filePath)
  if (url === '/') {
    filePath = path.join(__dirname, './index.html')
  }
  // 获取文件的最后修改时间
  let fileLastModifiedTime = getFileUpdatedDate(filePath)
  //console.log('lastTime', fileLastModifiedTime)
  const buffer = fs.readFileSync(filePath, 'utf-8')
  // 计算请求文件的md5值
  const hash = crypto.createHash('md5')
  hash.update(buffer, 'utf-8')
  // 得到etag
  const etag = `${hash.digest('hex')}`
  //console.log('etag', etag)
  if (ifNoneMatch === etag) {
    ctx.status = 304
    ctx.body = ''
    flag = true
  } else {
    // etag不一致 更新tag值，返回新的资源
    ctx.set('etag', etag)
    flag = false
  }
  // 没有文件的etag 比较 文件的最后修改时间
  if (!ifNoneMatch && ifModifiedSince === fileLastModifiedTime) {
    ctx.status = 304
    ctx.body = ''
    flag = true
  } else {
    // 最后修改时间不一致，更新最后修改时间，返回新的资源
    //ctx.set('Last-Modified', fileLastModifiedTime)
    ctx.set(
      'Last-Modified',
      Buffer.from(fileLastModifiedTime).toString('base64')
    )
    flag = false
  }
  return flag
}

app.use(async (ctx) => {
  const { url, query } = ctx.request
  const { 'if-none-match': ifNoneMatch, 'if-modified-since': ifModifiedSince } =
    ctx.request.headers
  // console.log(ctx.request.headers)
  // console.log('url', url)
  if (url === '/') {
    // 返回首页HTML
    ctx.type = 'text/html'
    ctx.body = fs.readFileSync('./index.html', 'utf8')
  } else if (url.endsWith('.js')) {
    // 设置协商缓存
    ctx.set('cache-control', 'no-cache')
    // 判断是否读取缓存
    const used = ifUseCache(ctx, url, ifNoneMatch, ifModifiedSince)
    if (used) {
      ctx.status = 304
      ctx.body = null
      return
    }
    //响应js请求
    const jsPath = path.join(__dirname, url) //获取绝对路径
    ctx.type = 'text/javascript'
    const file = fs.readFileSync(jsPath, 'utf-8')
    // 裸模块替换成/@modules/包名，浏览器就会发起请求
    // import { createApp, h } from 'vue'
    // 替换为
    // import { createApp, h } from "/@modules/vue"
    ctx.body = rewirteImport(file)
  } else if (url.startsWith('/@modules/')) {
    // 依赖使用强缓存
    ctx.set('cache-control', 'max-age=31536000,immutable')
    // 返回裸模快引用的node_modules/包名/package.json.module引用的真实文件
    ctx.type = 'application/javascript'
    /** 得到node_modules/包名/package.json 里面的moudule路劲 */
    const filePrefix = path.resolve(
      __dirname,
      'node_modules',
      url.replace('/@modules/', '')
    )
    const module = require(filePrefix + '/package.json').module
    const file = fs.readFileSync(filePrefix + '/' + module, 'utf-8')
    ctx.body = rewirteImport(file)
  } else if (url.includes('.vue')) {
    const usedCache = ifUseCache(
      ctx,
      url.slice(1).split('?')[0],
      ifNoneMatch,
      ifModifiedSince
    )
    if (usedCache) {
      ctx.status = 304
      ctx.body = null
      return
    }
    // 读取vue文件内容
    const filePath = path.join(__dirname, url.split('?')[0])
    // compilerSfc解析SFC，得到一个ast
    const { descriptor } = compilerSfc.parse(fs.readFileSync(filePath, 'utf-8'))
    // console.log(descriptor)
    // 处理script
    if (!query.type) {
      // 获取script
      const scriptContent = descriptor.script.content
      // export default {...} 更改为  const __script = {...}
      const script = scriptContent.replace(
        'export default ',
        'const __script = '
      )
      // 返回App.vue解析结果
      ctx.type = 'text/javascript'
      ctx.body = `
        ${rewirteImport(script)}
        // 发送请求获取template部分,这里返回一个渲染函数
        import { render as __render } from '${url}?type=template'
        // 如果有 style 就发送请求获取 style 的部分
        ${descriptor.styles.length ? `import "${url}?type=style"` : ''}
        __script.render = __render
        export default __script
      `
    } else if (query.type == 'template') {
      const templateContent = descriptor.template.content
      const render = compilerDom.compile(templateContent, {
        mode: 'module'
      }).code
      ctx.type = 'text/javascript'
      ctx.body = rewirteImport(render)
    } else if (query.type == 'style') {
      const styles = descriptor.styles
      let css = ''
      if (styles.length > 0) {
        styles.forEach((o, i) => {
          css += `${o.content.replace(/[\n\r]/g, '')}`
        })
      }
      // console.log(styles)
      const content = `
        const css = "${css}"
        let link = document.createElement('style')
        link.setAttribute('type', 'text/css')
        document.head.appendChild(link)
        link.innerHTML = css
        export default css
    `
      ctx.type = 'application/javascript'
      ctx.body = content
    }
  }
})

// 裸模块替换
// import xxx from "xxx" --> import xxx from "/@modules/xxx"

function rewirteImport(content) {
  return content.replace(/ from ['"](.*)['"]/g, (s1, s2) => {
    // s1, 匹配部分， s2: 匹配分组内容
    if (s2.startsWith('./') || s2.startsWith('/') || s2.startsWith('../')) {
      // 相对路劲直接返回
      return s1
    } else {
      return ` from "/@modules/${s2}"`
    }
  })
}

app.listen(8083, () => {
  console.log('mini vite start ~')
})

/*
强制缓存
cache-control ：
  max-age=300 //用来设置资源可以被缓存多长时间，单位为秒；
  no-cache  强制客户端直接向服务器发送请求,也就是说每次请求都必须向服务器发送。
            服务器接收到请求，然后判断资源是否变更，是则返回新内容，否则返回304，未变更。
            这个很容易让人产生误解，使人误以为是响应不被缓存。实际上是会被缓存的.
            只不过每次在向客户端（浏览器）提供响应数据时，缓存都要向服务器评估缓存响应的有效性。
  no-store  禁止一切缓存（这个才是响应不被缓存的意思）。
  private:只能被浏览器缓存，默认就是 private
  public:可以被浏览器或代理服务器缓存
  s-maxage 缓存在代理服务器中的过期时长

cache-control是http1.1的头字段，相对时间
expires是http1.0的头字段,（依赖本地时间戳） 是绝对时间
如果expires和cache-control同时存在，cache-control会覆盖expires，建议两个都写。


协商缓存
协商缓存是指在使用本地缓存之前，需要向服务端发起一次GET请求，与之协商当前浏览器保存的本地缓存是否过期
Last-Modifed/If-Modified-Since和Etag/If-None-Match是分别成对出现的，呈一一对应关系

ETag 资源对应的唯一字符串(服务器生成返回给前端)   优先 http1.1
If-None-Match 当资源过期时，浏览器发现响应头里有Etag,则再次向服务器请求时带上请求头if-none-match(值是Etag的值)。
              服务器收到请求进行比对，决定返回200或304

Last-Modified 资源上一次修改的时间  秒级别  http1.0
If-Modified-Since 当资源过期时（浏览器判断Cache-Control标识的max-age过期）
  发现响应头具有Last-Modified声明，则再次向服务器请求时带上头if-modified-since，表示请求时间
  如果请求时间小于Last-Modified 说明资源又被改过，则返回最新资源，HTTP 200 OK;
  如果请求时间大于Last-Modified 说明资源无新修改，响应HTTP 304 走缓存。
*/
