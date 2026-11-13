const {createHandler}=require('../app/server.cjs');
const handler=createHandler(process.env.OPENAI_API_KEY,{hosted:true});
module.exports=(req,res)=>{req.url='/api/expand';return handler(req,res);};
