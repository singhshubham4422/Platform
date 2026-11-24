import { getLanguage, type LanguageId } from '@lplatform/language-config';
const key=(id:string)=>`lp_platform_lang_${id}`;
export function LanguagePicker({packId,languages,value,onChange}:{packId:string;languages:string[];value:LanguageId;onChange:(v:LanguageId)=>void}){
 const opts=languages.filter((x):x is LanguageId=>Boolean(getLanguage(x)));
 return <label className="platform-field">Language<select value={value} onChange={e=>{const v=e.target.value as LanguageId;localStorage.setItem(key(packId),v);onChange(v)}}>{opts.map(x=><option key={x} value={x}>{getLanguage(x)?.label??x}</option>)}</select></label>
}
