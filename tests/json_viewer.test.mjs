import test from 'node:test';
import assert from 'node:assert/strict';
import {createJsonViewer} from '../src/json_viewer.js';

// Minimal DOM model: identity and lazy disclosure lifecycle, not layout.
class Node {
  constructor(tag,document){this.tag=tag;this.ownerDocument=document;this.nodes=[];this.parent=null;this.listeners={};this.open=false;this.classList={add(){}};this.text='';}
  get children(){return this.nodes.filter(n=>n.tag!=='#text');}
  get isConnected(){return this.tag==='root'||!!this.parent?.isConnected;}
  set textContent(text){this.replaceChildren();this.text=String(text);}
  get textContent(){return this.text+this.nodes.map(n=>n.textContent).join('');}
  append(...nodes){for(const node of nodes)this.insertBefore(node,null);}
  insertBefore(node,before){node.remove();const i=before?this.nodes.indexOf(before):this.nodes.length;this.nodes.splice(i,0,node);node.parent=this;}
  remove(){if(this.parent){this.parent.nodes.splice(this.parent.nodes.indexOf(this),1);this.parent=null;}}
  replaceWith(node){const p=this.parent;p.insertBefore(node,this);this.remove();}
  replaceChildren(...nodes){for(const child of [...this.nodes])child.remove();this.text='';this.append(...nodes);}
  closest(tag){return this.parent?.tag===tag?this.parent:this.parent?.closest(tag)??null;}
  addEventListener(event,callback){(this.listeners[event]??=[]).push(callback);}
  toggle(){for(const callback of this.listeners.toggle??[])callback();}
  querySelectorAll(tag){return this.nodes.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)]);}
}
function dom(outer=false){
  const document={createElement(tag){return new Node(tag,this);},createTextNode(text){const n=new Node('#text',this);n.text=text;return n;}};
  const root=new Node('root',document),container=document.createElement('div');
  let details=null;if(outer){details=document.createElement('details');root.append(details);details.append(container);}else root.append(container);
  return {container,details,viewer:createJsonViewer(container)};
}
test('live JSON updates preserve expanded branch and summary identity, lazily rendering latest children',()=>{
  const {container,viewer}=dom();viewer.update({metrics:{elapsed:1,nested:[1,2]}});
  const branch=container.children[0],summary=branch.children[0];assert.equal(branch.children.length,1);
  branch.open=true;branch.toggle();const child=branch.children[1];
  viewer.update({metrics:{elapsed:2,nested:[3,4]}});
  assert.equal(container.children[0],branch);assert.equal(branch.children[0],summary);assert.equal(branch.open,true);
  assert.match(child.textContent,/2/);
  const nested=child.children[1];nested.open=true;nested.toggle();
  viewer.update({metrics:{elapsed:3,nested:[5]}});assert.equal(nested.open,true);assert.match(nested.textContent,/5/);
  viewer.collapseAll();assert.equal(branch.open,false);assert.equal(nested.open,false);
});
test('closed outer inspector renders latest data on opening and strings remain text',()=>{
  const {container,details,viewer}=dom(true);
  viewer.update({old:1});viewer.update({latest:'<img src=x onerror=bad>'});assert.equal(container.children.length,0);
  details.open=true;details.toggle();assert.match(container.textContent,/latest/);assert.doesNotMatch(container.textContent,/old/);
  assert.equal(container.querySelectorAll('img').length,0);assert.match(container.textContent,/<img/);
});
test('JSON handles long strings, shape changes, removed keys and reordered branches',()=>{
  const {container,viewer}=dom();viewer.update({a:'x'.repeat(130),b:[1]});
  const branch=container.children[0];branch.open=true;branch.toggle();assert.match(branch.textContent,/x{130}/);
  viewer.update({b:[2],a:{nested:1}});assert.equal(container.children[1],branch);assert.match(branch.textContent,/nested/);
  viewer.update({a:{nested:2}});assert.equal(container.children.length,1);assert.equal(container.children[0],branch);
  viewer.update({a:null});assert.equal(container.children[0].tag,'div');assert.match(container.textContent,/null/);
});
