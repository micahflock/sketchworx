import { init_planegcs_module, GcsWrapper, Algorithm } from "@salusoft89/planegcs";
const mod = await init_planegcs_module();
function mk() { return new GcsWrapper(new mod.GcsSystem()); }
const pts = (arr)=>arr.map(([id,x,y])=>({id,type:'point',x,y,fixed:false}));
function rect(extra=[]) {
  return [
    ...pts([['p1',0,0],['p2',10,0.5],['p3',10.3,8],['p4',-0.2,8.2]]),
    {id:'l1',type:'line',p1_id:'p1',p2_id:'p2'},
    {id:'l2',type:'line',p1_id:'p2',p2_id:'p3'},
    {id:'l3',type:'line',p1_id:'p3',p2_id:'p4'},
    {id:'l4',type:'line',p1_id:'p4',p2_id:'p1'},
    {id:'h1',type:'horizontal_l',l_id:'l1'},
    {id:'h2',type:'horizontal_l',l_id:'l3'},
    {id:'v1',type:'vertical_l',l_id:'l2'},
    {id:'v2',type:'vertical_l',l_id:'l4'},
    {id:'f1',type:'coordinate_x',p_id:'p1',x:0},
    {id:'f2',type:'coordinate_y',p_id:'p1',y:0},
    ...extra];
}
let g = mk();
g.push_primitives_and_params(rect());
let t=performance.now(); let st=g.solve(); console.log('status',st,'ms',(performance.now()-t).toFixed(2));
g.apply_solution();
console.log('dof',g.gcs.dof(), 'redundant',g.get_gcs_redundant_constraints(),'conflicting',g.get_gcs_conflicting_constraints());
console.log(g.sketch_index.get_primitives().filter(p=>p.type==='point').map(p=>[p.id,p.x.toFixed(3),p.y.toFixed(3)].join(' ')));
// redundant
g.clear_data(); g.push_primitives_and_params(rect([{id:'par',type:'parallel',l1_id:'l1',l2_id:'l3'}]));
st=g.solve(); console.log('redundant case status',st,'dof',g.gcs.dof(),'redundant',g.get_gcs_redundant_constraints(),'conflicting',g.get_gcs_conflicting_constraints(), 'partial', g.get_gcs_partially_redundant_constraints());
// conflicting
g.clear_data(); g.push_primitives_and_params(rect([{id:'vbad',type:'vertical_l',l_id:'l1'}]));
st=g.solve(); console.log('conflict case status',st,'dof',g.gcs.dof(),'redundant',g.get_gcs_redundant_constraints(),'conflicting',g.get_gcs_conflicting_constraints());
// drag p3 towards (20,15) with temp constraints
g.clear_data(); g.push_primitives_and_params(rect([
 {id:'dx',type:'coordinate_x',p_id:'p3',x:20,temporary:true},
 {id:'dy',type:'coordinate_y',p_id:'p3',y:15,temporary:true}]));
t=performance.now(); st=g.solve(); g.apply_solution(); console.log('drag status',st,'ms',(performance.now()-t).toFixed(2));
console.log(g.sketch_index.get_primitives().filter(p=>p.type==='point').map(p=>[p.id,p.x.toFixed(3),p.y.toFixed(3)].join(' ')));
// arc
g.clear_data(); g.push_primitives_and_params([
 ...pts([['c',0,0],['s',10,0],['e',0,10]]),
 {id:'a',type:'arc',c_id:'c',start_id:'s',end_id:'e',radius:10,start_angle:0,end_angle:Math.PI/2},
 {id:'ar',type:'arc_rules',a_id:'a'},
 {id:'r',type:'arc_radius',a_id:'a',radius:5},
]);
st=g.solve(); g.apply_solution(); console.log('arc',st,g.gcs.dof(),JSON.stringify(g.sketch_index.get_primitives().slice(0,4)));
// perf: 200 rects drag
g.clear_data(); let big=[];
for(let i=0;i<50;i++){ const o=i*30; big.push(...rect().map(p=>{const q={...p,id:p.id+'_'+i}; for(const k of ['p_id','p1_id','p2_id','l_id','l1_id','l2_id']) if(q[k]) q[k]=q[k]+'_'+i; if(q.type==='point'){q.x+=o;} if(q.type==='coordinate_x') q.x=o; return q;})); }
big.push({id:'dx',type:'coordinate_x',p_id:'p3_0',x:20,temporary:true},{id:'dy',type:'coordinate_y',p_id:'p3_0',y:15,temporary:true});
t=performance.now(); g.push_primitives_and_params(big); const tp=performance.now()-t; t=performance.now(); st=g.solve(); console.log('200 lines drag: push ms',tp.toFixed(1),'solve ms',(performance.now()-t).toFixed(1),'status',st);
g.clear_data(); big.splice(-2); t=performance.now(); g.push_primitives_and_params(big); st=g.solve(); console.log('200 lines full solve+dof', (performance.now()-t).toFixed(1),'dof',g.gcs.dof());
