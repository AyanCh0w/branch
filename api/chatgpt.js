const {createHandler}=require('../app/server.cjs');
module.exports=createHandler(process.env.OPENAI_API_KEY,{hosted:true});
