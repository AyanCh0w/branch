// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const {query,mutate}=vi.hoisted(()=>({query:vi.fn(),mutate:vi.fn()}));
vi.mock('../backend/react',()=>({api:{library:{list:'library:list'},chatgptBrowser:{connect:'connect',connectDesktop:'connectDesktop',count:'count',disconnectBoard:'disconnectBoard'}},useQuery:()=>query(),useMutation:()=>mutate}));
import {ChromeSyncSettings,ConnectChatGPTSync} from '../accounts/chrome-sync';
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

it.each([
 {hasApp:true,published:true},
 {hasApp:false,published:true},
 {hasApp:false,published:false},
])('copies setup with the correct download behavior ($hasApp installed, $published published)',async({hasApp,published})=>{
 query.mockReturnValue(0);
 const installer='/downloads/branch-for-mac.dmg';
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:published,json:async()=>({installer})}));
 const download=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this:HTMLAnchorElement){
  expect(this.getAttribute('href')).toBe(installer);
  expect(this.download).toBe('branch-for-mac.dmg');
 });
 let clipboardComplete!:()=>void;
 const writeText=vi.fn(()=>new Promise<void>(resolve=>{clipboardComplete=resolve;}));
 const previousClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const Dialog=({children}:{children:React.ReactNode})=>React.createElement('section',null,children);
 try{
  await act(async()=>root.render(React.createElement(ChromeSyncSettings,{boardId:'chosen',Dialog,onClose:vi.fn()})));
  const buttons=container.querySelectorAll('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].textContent).toBe('Set up with your agent');
  expect(container.querySelector('a')).toBeNull();
  await act(async()=>buttons[0].click());
  expect(container.textContent).toContain('Do you already have Branch for Mac?');
  expect(download).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  const label=hasApp?'Yes, I have it':'No, download it';
  const answer=[...container.querySelectorAll('button')].find(button=>button.textContent===label)!;
  await act(async()=>answer.click());
  expect(download).toHaveBeenCalledTimes(!hasApp&&published?1:0);
  expect(container.querySelector('[role="status"]')?.textContent).not.toContain('Paste the instructions');
  await act(async()=>clipboardComplete());
  expect(container.querySelector('button')?.textContent).toContain('Copied to clipboard');
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Paste the instructions');
  expect(container.querySelector('a[download]')?.textContent).toBe(!hasApp&&published?'Download again':undefined);
  expect(container.textContent.includes('installer isn’t available')).toBe(!hasApp&&!published);
  const [[prompt]]=writeText.mock.calls;
  expect(prompt).toContain('https://joinbranch.dev/app?board=chosen#mac-sync=open');
  expect(prompt).not.toMatch(/github|swift|clone|build-probe/i);
 }finally{
  await act(async()=>root.unmount());container.remove();
  if(previousClipboard)Object.defineProperty(navigator,'clipboard',previousClipboard);
  else Reflect.deleteProperty(navigator,'clipboard');
 }
});
