import React,{useState,useEffect,useId} from 'react';
import {useBackend,api} from '../backend/react';

export function UsernameInput({value,onChange,disabled,boardId,teamId,label='Add people by username'}){
 const client=useBackend(),id=useId();
 const [focused,setFocused]=useState(false),[dismissed,setDismissed]=useState(false),[active,setActive]=useState(-1),[result,setResult]=useState(null);
 const prefix=value.trim().replace(/^@/,'').toLowerCase();
 const open=focused&&!dismissed&&!disabled&&prefix.length>=2;
 useEffect(()=>{
  if(!open)return;
  let current=true;setResult(null);
  const timer=setTimeout(()=>{client.query(api.invitations.suggestions,{prefix,...(boardId?{boardId}:{teamId})}).then(items=>{if(current)setResult({prefix,items});}).catch(()=>{if(current)setResult({prefix,items:[],failed:true});});},120);
  return()=>{current=false;clearTimeout(timer);};
 },[client,prefix,boardId,teamId,open]);
 const current=result?.prefix===prefix?result:null,items=current?.items||[];
 const select=item=>{onChange(item.username);setDismissed(true);setActive(-1);};
 return <div className="a-username-field">
 <label className="a-field" htmlFor={id}>{label}<input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open?id+'-list':undefined} aria-activedescendant={open&&items[active]?id+'-'+active:undefined} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Branch username" value={value} required disabled={disabled}
 onFocus={()=>{setFocused(true);setDismissed(false);}} onBlur={()=>{setFocused(false);setActive(-1);}}
 onChange={e=>{onChange(e.target.value);setDismissed(false);setActive(-1);}}
 onKeyDown={e=>{
  if(e.nativeEvent.isComposing)return;
  if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setDismissed(true);}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setDismissed(false);if(items.length)setActive(i=>(i+(e.key==='ArrowDown'?1:i<0?0:-1)+items.length)%items.length);}
  else if(e.key==='Enter'&&open&&items[active]){e.preventDefault();select(items[active]);}
 }}/></label>
 {open&&<div className="a-username-popup"><div id={id+'-list'} role="listbox" aria-label="Matching usernames">{items.map((item,index)=><div key={item.userId} id={id+'-'+index} role="option" aria-selected={index===active} className="a-share-person" onPointerDown={e=>e.preventDefault()} onClick={()=>select(item)}><span className="a-member-details"><strong>{item.name}</strong><small>@{item.username}</small></span></div>)}</div><p className="a-username-status" role="status">{!current?'Looking up usernames…':current.failed?'Suggestions unavailable. Enter a full username.':items.length?'↑ ↓ to choose · Enter to select':'No matching accounts to invite.'}</p></div>}
 </div>;
}
