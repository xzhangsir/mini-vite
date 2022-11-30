const Koa = require('koa')
const fs = require('fs')
const path = require('path')
//单文件处理是使用的是@vue/compiler-sfc模块进行编译处理的
const compilerSfc = require('@vue/compiler-sfc')
//处理模版的编译
const compilerDom = require('@vue/compiler-dom')

const app = new Koa()

app.use(async (ctx) => {
  const { url, query } = ctx.request
  // console.log('url', url)
  if (url === '/') {
    // 返回首页HTML
    ctx.type = 'text/html'
    ctx.body = fs.readFileSync('./index.html', 'utf8')
  } else if (url.endsWith('.js')) {
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
