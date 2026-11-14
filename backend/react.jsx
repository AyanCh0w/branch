import React,{createContext,useContext,useEffect,useState,useCallback} from 'react';
export {BranchClient,api,makeFunctionReference} from './browser';
const Context=createContext(null);
export function BackendProvider({client,children}){return <Context.Provider value={client}>{children}</Context.Provider>;}
export const useBackend=()=>useContext(Context);
function useSession(){const client=useBackend();const [,change]=useState(0);useEffect(()=>{const fn=()=>change(n=>n+1);client.authListeners.add(fn);fn();return()=>client.authListeners.delete(fn);},[client]);return client;}
export const useBackendAuth=()=>{const c=useSession();return {isAuthenticated:!!c.session,isLoading:c.loading};};
export const useAuthToken=()=>useSession().session?.access_token;
export const useAuthActions=()=>{const c=useBackend();return {signOut:()=>c.signOut()};};
export function useQuery(name,args={}){
 const client=useSession(),key=String(name)+':'+JSON.stringify(args),epoch=client.epoch;
 const [result,set]=useState({});
 useEffect(()=>{if(args==='skip')return;return client.onUpdate(name,args,value=>set({key,epoch,value}),error=>set({key,epoch,error}));},[client,name,key,epoch]);
 if(args==='skip'||result.key!==key||result.epoch!==epoch)return undefined;if(result.error)throw result.error;return result.value;
}
export function useMutation(name){const c=useBackend();return useCallback(args=>c.mutation(name,args),[c,name]);}
export function useAction(name){const c=useBackend();return useCallback(args=>c.action(name,args),[c,name]);}
function usePassword(action){const c=useBackend(),[pending,set]=useState(false);const run=async args=>{set(true);try{return await c.auth(action,args);}catch(e){return {status:'error',message:e.message};}finally{set(false);}};return {pending,signIn:run,signUp:run};}
export const useSignInWithUsernamePassword=()=>usePassword('signin');
export const useSignUpWithUsernamePassword=()=>usePassword('signup');
