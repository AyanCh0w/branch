// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
const {query,client}=vi.hoisted(()=>{const query=vi.fn();return {query,client:{query}};});
vi.mock('../backend/react',()=>({useBackend:()=>client,api:{invitations:{suggestions:'invitations:suggestions'}}}));
import {UsernameInput} from '../accounts/username-input';
it('supports keyboard selection without submitting, Escape dismissal and manual-entry fallback',async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 vi.useFakeTimers();
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container),change=vi.fn();
 query.mockResolvedValue([{userId:'1',name:'Alice',username:'alice'}]);
 try{
 await act(async()=>root.render(React.createElement(UsernameInput,{value:'al',onChange:change,boardId:'board'})));
 const input=container.querySelector('input')!;
 await act(async()=>input.focus());
 await act(async()=>{await vi.advanceTimersByTimeAsync(130);});
 expect(container.querySelector('[role=option]')?.textContent).toContain('@alice');
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));
 expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
 const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
 await act(async()=>input.dispatchEvent(enter));
 expect(enter.defaultPrevented).toBe(true);expect(change).toHaveBeenCalledWith('alice');
 expect(input.getAttribute('aria-expanded')).toBe('false');
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})));
 await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
 expect(input.getAttribute('aria-expanded')).toBe('false');
 query.mockRejectedValue(new Error('Unavailable'));
 await act(async()=>{input.blur();input.focus();});
 await act(async()=>{await vi.advanceTimersByTimeAsync(130);});
 expect(container.textContent).toContain('Enter a full username');expect(input.disabled).toBe(false);
 }finally{await act(async()=>root.unmount());container.remove();vi.useRealTimers();}
});
