import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,{auth:{persistSession:false}});
const SOURCE='20000000-0000-4000-8000-000000000001';
const email='socios@comanda.dev';
const password=process.env.DEMO_USER_PASSWORD;
if(!password || password.length<12)throw Error('Defina DEMO_USER_PASSWORD com 12 caracteres ou mais');
async function ok<T>(q:PromiseLike<{data:T;error:unknown}>):Promise<NonNullable<T>>{const r=await q;if(r.error)throw r.error;return r.data as NonNullable<T>;}
async function main(){
 const users=await db.auth.admin.listUsers({perPage:1000});if(users.error)throw users.error;
 let user=users.data.users.find(u=>u.email===email);
 if(!user){const r=await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name:'Sócios Nutrivox'}});if(r.error)throw r.error;user=r.data.user;}
 const source=await ok(db.from('restaurants').select('*').eq('id',SOURCE).single());
 let restaurant=await ok(db.from('restaurants').select('*').eq('slug','brasa-demo').maybeSingle());
 if(!restaurant){restaurant=await ok(db.from('restaurants').insert({reseller_id:source.reseller_id,name:'Brasa Bistrô',slug:'brasa-demo',cover_url:source.cover_url,logo_url:source.logo_url,status:'active',primary_color:'#d9532a',background_color:'#faf7f2'}).select().single());
 const categories=await ok(db.from('categories').select('*').eq('restaurant_id',SOURCE).order('position'));
 const items=await ok(db.from('menu_items').select('*,modifier_groups(*,modifiers(*))').eq('restaurant_id',SOURCE).order('position'));
 for(const c of categories){const nc=await ok(db.from('categories').insert({restaurant_id:restaurant.id,name:c.name,position:c.position,active:c.active}).select().single());
 const sorted=items.filter(i=>i.category_id===c.id).sort((a,b)=>{const rank=(n:string)=>n.toLowerCase().includes('pastel')?0:n.toLowerCase().includes('bolinho')?1:n.toLowerCase().includes('burrata')?2:10;return rank(a.name)-rank(b.name)||a.position-b.position;});
 for(const [position,i] of sorted.entries()){const ni=await ok(db.from('menu_items').insert({restaurant_id:restaurant.id,category_id:nc.id,name:i.name,description:i.description,price_cents:i.price_cents,photo_url:i.photo_url,prep_minutes:i.prep_minutes,position,active:true,sold_out:false,featured:i.featured}).select().single());for(const g of i.modifier_groups){const ng=await ok(db.from('modifier_groups').insert({menu_item_id:ni.id,name:g.name,required:g.required,min_select:g.min_select,max_select:g.max_select,position:g.position}).select().single());await ok(db.from('modifiers').insert(g.modifiers.map((m:Record<string,unknown>)=>({group_id:ng.id,name:m.name,price_cents:m.price_cents,position:m.position}))));}}
 }
 await ok(db.from('tables').insert(Array.from({length:12},(_,i)=>({restaurant_id:restaurant.id,label:String(i+1)}))));
 }
 await ok(db.from('restaurant_members').upsert({user_id:user.id,restaurant_id:restaurant.id,role:'manager'}));
 const entryCategory=await ok(db.from('categories').select('id').eq('restaurant_id',restaurant.id).eq('name','Entradas').single());
 const demoExtras=[['Pastel de queijo da serra','Massa crocante com queijo artesanal.',3290],['Bolinho de costela','Crocante por fora, macio por dentro.',3800],['Burrata com tomate tostado','Tomates assados, pesto e pão rústico.',4600]] as const;
 for(const [position,[name,description,price_cents]] of demoExtras.entries()) {const existingItem=await ok(db.from('menu_items').select('id').eq('restaurant_id',restaurant.id).eq('name',name).maybeSingle());if(!existingItem)await ok(db.from('menu_items').insert({restaurant_id:restaurant.id,category_id:entryCategory.id,name,description,price_cents,photo_url:'https://images.unsplash.com/photo-1544025162-d76694265947',prep_minutes:12,position:position,active:true,sold_out:false,featured:false}));}
 const tables=await ok(db.from('tables').select('*').eq('restaurant_id',restaurant.id));
 const items=await ok(db.from('menu_items').select('*').eq('restaurant_id',restaurant.id));
 const existing=await ok(db.from('orders').select('id').eq('restaurant_id',restaurant.id).limit(1));
 if(!existing.length){
 const now=Date.now();const active=[12,4,9,2,6,8];const tabs=[];
 for(const [index,label] of active.entries()){const table=tables.find(t=>t.label===String(label))!;tabs.push(await ok(db.from('tabs').insert({restaurant_id:restaurant.id,table_id:table.id,pin:String(4826+index),opened_by:user.id,opened_at:new Date(now-80*60000).toISOString()}).select().single()));}
 const names=['Picanha','Risoto','Pastel','Bolinho','Burrata','Caipirinha'];const picked=names.map(n=>items.find(i=>i.name.toLowerCase().includes(n.toLowerCase()))!).filter(Boolean);
 for(let index=0;index<26;index++){
 const live=index<6;const tab=tabs[index%tabs.length];const status=live?(index===0?'em_preparo':index===1?'recebido':index===2?'em_preparo':index===3?'recebido':'pronto'):'entregue';
 const minutes=live?[18,6,12,3,7,9][index]:90+(index-6)*12;const created=now-minutes*60000;
 const lines=live?[picked[index%4],picked[(index+4)%picked.length]]:[picked[index%picked.length]];
 const total=lines.reduce((sum,i,j)=>sum+i.price_cents*(j===0?2:1),0);
 const order=await ok(db.from('orders').insert({restaurant_id:restaurant.id,tab_id:tab.id,status,prep_minutes:Math.max(...lines.map(i=>i.prep_minutes)),total_cents:total,created_at:new Date(created).toISOString(),started_at:status!=='recebido'?new Date(created+60000).toISOString():null,ready_at:['pronto','entregue'].includes(status)?new Date(created+5*60000).toISOString():null,delivered_at:status==='entregue'?new Date(created+6*60000).toISOString():null}).select().single());
 await ok(db.from('order_items').insert(lines.map((i,j)=>({order_id:order.id,menu_item_id:i.id,name_snapshot:i.name,unit_price_cents:i.price_cents,quantity:j===0?2:1,note:live&&index===0&&j===0?'Sem cebola':null,modifiers_snapshot:i.name.toLowerCase().includes('picanha')?[{group:'Ponto da carne',name:'Ao ponto',price_cents:0}]:[]}))));
 }
 }
 const tabs=await ok(db.from('tabs').select('id,pin,table_id').eq('restaurant_id',restaurant.id).eq('status','open'));
 const table=tables.find(t=>t.label==='12')!;
 writeFileSync('tmp/demo-access.json',JSON.stringify({email,restaurantId:restaurant.id,slug:restaurant.slug,qr:table.qr_token,pin:tabs.find(t=>t.table_id===table.id)?.pin,tables:tables.length,items:items.length}));
 console.log('Demonstração pronta: 1 gestor com acesso ao salão e cozinha, '+items.length+' itens e '+tables.length+' mesas.');
}
main().catch(e=>{console.error(e.message||e);process.exitCode=1});
