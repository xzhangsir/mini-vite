const Koa = require('koa')
const app = new Koa()
const fs = require('fs')
const path = require('path')

// 返回用户首页
app.use(async ctx => {
    const  {url,query} = ctx.request
    if(url === '/'){
    	ctx.type = "text/html"
    	ctx.body = fs.readFileSync('./index.html', 'utf8')
    }else if(url.endsWith(".js")){
    	//响应js请求
    	const jsPath = path.join(__dirname,url)
    	ctx.type = "text/javascript"
    	ctx.body = fs.readFileSync(jsPath,"utf-8")
    }
})


app.listen(8083, () => {
    console.log("mini vite start ~")
})