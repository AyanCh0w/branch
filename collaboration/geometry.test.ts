import {it,expect,vi,afterEach} from 'vitest';
import {geometryPreviews,geometryPublisher} from './geometry';
afterEach(()=>vi.useRealTimers());
it('renders drag previews without changing saved geometry; expiry and local gestures restore control',()=>{
 let now=0,held=false;const node={id:'n',x:0,y:0,width:400};const paint=vi.fn();
 const host={getState:()=>({nodes:[node]}),isManipulating:()=>held,previewGeometry:paint};
 const preview=geometryPreviews({host,tabId:'local',now:()=>now});const message={type:'geometry',userId:'other',tabId:'remote',nodes:[{id:'n',x:50,y:70}]};
 preview.receive(message);expect(paint).toHaveBeenLastCalledWith('n',{x:50,y:70});expect(node.x).toBe(0);
 now=5000;preview.render();expect(paint).toHaveBeenLastCalledWith('n',{});
 preview.receive(message);held=true;preview.render();expect(paint).toHaveBeenLastCalledWith('n',{});
 held=false;preview.receive(message);node.x=50;node.y=70;preview.render();expect(paint).toHaveBeenLastCalledWith('n',{});
});
it('does not resurrect deleted cards and clears disconnected previews',()=>{
 let nodes=[{id:'n',x:0,y:0}];const paint=vi.fn();const p=geometryPreviews({host:{getState:()=>({nodes}),previewGeometry:paint},tabId:'local'});
 p.receive({type:'geometry',tabId:'remote',nodes:[{id:'n',x:20}]});nodes=[];paint.mockClear();p.render();expect(paint).not.toHaveBeenCalled();
 nodes=[{id:'n',x:0,y:0}];p.receive({type:'geometry',tabId:'remote',userId:'person',nodes:[{id:'n',x:20}]});p.receive({type:'leave',tabId:'remote',userId:'person'});expect(paint).toHaveBeenLastCalledWith('n',{});
});
it('coalesces movement, keeps stationary drags alive and sends the final or cancelled position immediately',async()=>{
 vi.useFakeTimers();const n={id:'n',x:0,y:0,privateData:'no'};const send=vi.fn();const p=geometryPublisher({send,getNodes:()=>[n]});
 for(let x=0;x<100;x++){n.x=x;p.publish([n]);}await vi.advanceTimersByTimeAsync(33);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.lastCall![0].nodes).toEqual([{id:'n',x:99,y:0}]);
 await vi.advanceTimersByTimeAsync(1000);expect(send).toHaveBeenCalledTimes(2);n.x=0;p.finish();expect(send.mock.lastCall![0].nodes[0].x).toBe(0);
 const count=send.mock.calls.length;await vi.advanceTimersByTimeAsync(5000);expect(send).toHaveBeenCalledTimes(count);p.close();
});
