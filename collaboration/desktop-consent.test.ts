// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const {query,mutate}=vi.hoisted(()=>({query:vi.fn(),mutate:vi.fn()}));
vi.mock('../backend/react',()=>({api:{library:{list:'library:list'},chatgptBrowser:{connect:'connect',connectDesktop:'connectDesktop',count:'count',disconnectBoard:'disconnectBoard'}},useQuery:()=>query(),useMutation:()=>mutate}));
import {ConnectChatGPTSync} from '../accounts/chrome-sync';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
afterEach(()=>{vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);});
it.each(['chosen','viewer','missing'])('preselects only editable destination %s and waits for explicit approval',async(hint)=>{
 query.mockReturnValue([{id:'chosen',title:'Chosen board',role:'owner'},{id:'other',title:'Other board',role:'editor'},{id:'viewer',title:'View only',role:'viewer'}]);
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const request=new URLSearchParams({board:hint,conversation:'a'.repeat(64),challenge:'b'.repeat(64)});
 try{
  await act(async()=>root.render(React.createElement(ConnectChatGPTSync,{request,desktop:true})));
  const select=container.querySelector('select')!;
  expect(select.value).toBe(hint==='chosen'?'chosen':'');
  expect(container.querySelector('option[value="viewer"]')).toBeNull();
  expect(mutate).not.toHaveBeenCalled();
  if(hint==='chosen'){
   await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
   expect(mutate).toHaveBeenCalledWith({boardId:'chosen',conversationId:'a'.repeat(64),keyHash:'b'.repeat(64)});
   expect(container.textContent).toContain('Board approved');
   expect(container.querySelector('a.a-primary[href="/app?board=chosen"]')?.textContent).toContain('Open this board');
   expect(container.querySelector('a.a-muted[href="joinbranch://connect"]')?.textContent).toContain('Return to Branch for Mac');
  }else expect((container.querySelector('button.a-primary') as HTMLButtonElement).disabled).toBe(true);
 }finally{await act(async()=>root.unmount());container.remove();}
});
