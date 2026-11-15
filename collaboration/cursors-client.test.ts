import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {startCursors} from './cursors';
let dom:JSDOM;
afterEach(()=>{dom?.window.close();vi.unstubAllGlobals();vi.useRealTimers();});
it('throttles board positions, reprojects remote cursors, expires them and cleans up presence',async()=>{
 vi.useFakeTimers();dom=new JSDOM('<div id="board"></div>',{pretendToBeVisual:true});
 const w=dom.window;vi.stubGlobal('document',w.document);vi.stubGlobal('window',w);
 let receive:(rows:any[])=>void=()=>{},connection:(state:any)=>void=()=>{},zoom=2;
 const off=vi.fn();const client={mutation:vi.fn(async()=>{}),connectionState:()=>({isWebSocketConnected:true}),onUpdate:(_name:any,_args:any,cb:any)=>{receive=cb;return off;},subscribeToConnectionState:(cb:any)=>{connection=cb;return off;}};
 const host={boardPoint:(x:number,y:number)=>({x:x/zoom,y:(y-60)/zoom}),screenPoint:(x:number,y:number)=>({x:x*zoom,y:y*zoom})};
 const stop=startCursors({client,host,scope:{boardId:'one',token:'test'},tabId:'local'});
 const board=w.document.getElementById('board')!;
 for(let x=0;x<100;x++)board.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:x,clientY:100}));
 await vi.advanceTimersByTimeAsync(1000);
 expect(client.mutation).toHaveBeenCalledTimes(1);
 expect(client.mutation.mock.calls[0]).toEqual(['collaboration:point',{boardId:'one',token:'test',tabId:'local',position:{x:49.5,y:20}}]);
 receive([{userId:'other',tabId:'remote',x:10,y:20,name:'<script>Alice</script>',color:'#123456',expiresAt:Date.now()+15000}]);
 const cursor=()=>w.document.querySelector('.human-cursor') as HTMLElement;
 expect(cursor().style.transform).toBe('translate3d(20px,40px,0)');
 expect(cursor().querySelector('span')!.textContent).toBe('<script>Alice</script>');expect(cursor().querySelector('script')).toBeNull();
 zoom=1;w.document.dispatchEvent(new w.Event('branch-camera'));
 expect(cursor().style.transform).toBe('translate3d(10px,20px,0)');
 connection({isWebSocketConnected:false});expect(cursor()).toBeNull();
 connection({isWebSocketConnected:true});expect(cursor()).not.toBeNull();
 w.dispatchEvent(new w.Event('blur'));await vi.advanceTimersByTimeAsync(1000);
 expect(client.mutation.mock.lastCall![1].position).toBeNull();
 await vi.advanceTimersByTimeAsync(16000);expect(cursor()).toBeNull();
 stop();expect(w.document.querySelector('.human-cursors')).toBeNull();expect(off).toHaveBeenCalledTimes(2);
 const count=client.mutation.mock.calls.length;
 board.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true}));await vi.advanceTimersByTimeAsync(5000);
 expect(client.mutation).toHaveBeenCalledTimes(count);
});
it('never turns live cursor movement into API requests while connecting, ready or reconnecting',async()=>{
 vi.useFakeTimers();dom=new JSDOM('<div id="board"></div>',{pretendToBeVisual:true});
 const w=dom.window;vi.stubGlobal('document',w.document);vi.stubGlobal('window',w);
 let ready=false,status=()=>{};const live={get ready(){return ready;},send:vi.fn(()=>true),subscribe:vi.fn(()=>()=>{}),onStatus:(cb:any)=>{status=cb;cb(false);return()=>{};}};
 const client={mutation:vi.fn(),onUpdate:vi.fn(),connectionState:()=>({isWebSocketConnected:true}),subscribeToConnectionState:()=>()=>{}};
 const host={boardPoint:(x:number,y:number)=>({x,y}),screenPoint:(x:number,y:number)=>({x,y})};
 const stop=startCursors({client,host,live,scope:{boardId:'test'},tabId:'local',userId:'self'});
 const board=w.document.getElementById('board')!;
 for(const connected of [false,true,false]){ready=connected;status();for(let i=0;i<600;i++){
  board.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:i,clientY:30}));await vi.advanceTimersByTimeAsync(16);
 }}
 stop();expect(live.send).toHaveBeenCalled();expect(client.mutation).not.toHaveBeenCalled();expect(client.onUpdate).not.toHaveBeenCalled();
});
