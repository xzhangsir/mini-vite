const Koa = require('koa')
const app = new Koa()
const fs = require('fs')
const path = require('path')

app.use(async (ctx) => {
  const { url, query } = ctx.request
  if (url === '/') {
    // 返回HTML
    ctx.type = 'text/html'
    ctx.body = fs.readFileSync('./index.html', 'utf8')
  } else if (url.endsWith('.js')) {
    //响应js请求
    const jsPath = path.join(__dirname, url) //获取绝对路径
    ctx.type = 'text/javascript'
    const file = fs.readFileSync(jsPath, 'utf-8')
    // 裸模块替换成/@modules/包名，浏览器就会发起请求
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
