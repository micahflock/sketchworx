import { init_planegcs_module, GcsWrapper } from "@salusoft89/planegcs";
const mod = await init_planegcs_module();
const g = new GcsWrapper(new mod.GcsSystem());
const pts = (arr)=>arr.map(([id,x,y])=>({id,type:'point',x,y,fixed:false}));
function rect(extra=[]) {
  return [ ...pts([['p1',0,0],['p2',10,0.5],['p3',10.3,8],['p4',-0.2,8.2]]),
    {id:'l1',type:'line',p1_id:'p1',p2_id:'p2'},{id:'l2',type:'line',p1_id:'p2',p2_id:'p3'},
    {id:'l3',type:'line',p1_id:'p3',p2_id:'p4'},{id:'l4',type:'line',p1_id:'p4',p2_id:'p1'},
    {id:'h1',type:'horizontal_l',l_id:'l1'},{id:'h2',type:'horizontal_l',l_id:'l3'},
    {id:'v1',type:'vertical_l',l_id:'l2'},{id:'v2',type:'vertical_l',l_id:'l4'},
    {id:'f1',type:'coordinate_x',p_id:'p1',x:0},{id:'f2',type:'coordinate_y',p_id:'p1',y:0}, ...extra];
}
for (const [name,extra] of [['parallel-redundant',[{id:'par',type:'parallel',l1_id:'l1',l2_id:'l3'}]],
   ['conflict-dist',[{id:'d1',type:'p2p_distance',p1_id:'p1',p2_id:'p2',distance:10},{id:'d2',type:'p2p_distance',p1_id:'p3',p2_id:'p4',distance:12}]],
   ['fixed+coord',[{id:'f3',type:'coordinate_x',p_id:'p1',x:5}]]]) {
  g.clear_data(); g.push_primitives_and_params(rect(extra));
  const st=g.solve(); g.apply_solution();
  const dof1=g.gcs.dof();
  console.log(name,'status',st,'dof',dof1,'red',g.get_gcs_redundant_constraints(),'conf',g.get_gcs_conflicting_constraints(),'partial',g.get_gcs_partially_redundant_constraints());
  // rebuild from solved
  const solved = g.sketch_index.get_primitives(); g.clear_data(); g.push_primitives_and_params(solved.map(p=>({...p})));
  console.log('  rebuilt dof',g.gcs.dof(),'red',g.get_gcs_redundant_constraints(),'conf',g.get_gcs_conflicting_constraints());
}
// param-driven drag
g.clear_data();
g.push_primitives_and_params([{type:'param',name:'dragx',value:20},{type:'param',name:'dragy',value:15}, ...rect([
 {id:'dx',type:'coordinate_x',p_id:'p3',x:'dragx',temporary:true},{id:'dy',type:'coordinate_y',p_id:'p3',y:'dragy',temporary:true}])]);
g.solve(); g.apply_solution(); console.log(g.sketch_index.get_primitive('p3'));
g.set_sketch_param('dragx',30); g.solve(); g.apply_solution(); console.log(g.sketch_index.get_primitive('p3'), g.sketch_index.get_primitive('p2'));
console.log('---- two pass');
for (const [name,extra] of [['clean',[]],['parallel-redundant',[{id:'par',type:'parallel',l1_id:'l1',l2_id:'l3'}]],['equal+?',[{id:'eq',type:'equal_length',l1_id:'l1',l2_id:'l3'}]]]) {
  g.clear_data(); g.push_primitives_and_params(rect(extra)); g.solve(); g.apply_solution();
  const solved = g.sketch_index.get_primitives().map(p=>({...p})); g.clear_data(); g.push_primitives_and_params(solved);
  const st=g.solve(); g.apply_solution();
  console.log(name,'st',st,'dof',g.gcs.dof(),'red',g.get_gcs_redundant_constraints(),'conf',g.get_gcs_conflicting_constraints(),'partial',g.get_gcs_partially_redundant_constraints());
}
