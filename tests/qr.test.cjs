'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../services/storage.js');require('../services/qr.js');
const D=globalThis.D20;
// Independent QR reader for this encoder's declared version/mask. It checks
// finder/format/version structure, extracts and de-interleaves codewords, checks
// every Reed-Solomon syndrome, then reads the UTF-8 byte payload.
function decode(modules){
  const n=modules.length;assert.equal(n,57);assert.ok(modules.every(row=>row.length===57));
  for(const [cx,cy] of [[3,3],[53,3],[3,53]])for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)assert.equal(modules[cy+y][cx+x],Math.max(Math.abs(x),Math.abs(y))!==2);
  const formatCells=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  assert.equal(formatCells.reduce((v,[x,y],i)=>v|(Number(modules[y][x])<<i),0),0x77c4); // Published L/mask-0 BCH value.
  let version=0;for(let bit=0;bit<18;bit++){const x=46+bit%3,y=Math.floor(bit/3);version|=Number(modules[y][x])<<bit;assert.equal(modules[y][x],modules[x][y]);}
  assert.equal(version,0x0a4d3);
  function reserved(x,y){
    if(x===6||y===6)return true;
    if((x<=8&&y<=8)||(x>=49&&y<=8)||(x<=8&&y>=49))return true;
    if((x>=46&&x<=48&&y<=5)||(y>=46&&y<=48&&x<=5))return true;
    for(const [cx,cy] of [[28,6],[6,28],[28,28],[50,28],[28,50],[50,50]])if(Math.abs(x-cx)<=2&&Math.abs(y-cy)<=2)return true;
    return false;
  }
  const raw=[];let upward=true;
  for(let x=56;x>0;x-=2){if(x===6)x--;for(let row=0;row<57;row++){
    const y=upward?56-row:row;
    for(const col of [x,x-1])if(!reserved(col,y))raw.push(Number(modules[y][col])^Number((col+y)%2===0));
  }upward=!upward;}
  assert.equal(raw.length,346*8);
  const code=Array.from({length:346},(_,i)=>raw.slice(i*8,i*8+8).reduce((v,b)=>v*2+b,0));
  const blocks=[[],[],[],[]];let p=0;
  for(let i=0;i<69;i++)for(let block=0;block<4;block++)if(i<(block<2?68:69))blocks[block].push(code[p++]);
  const data=blocks.flat();for(let i=0;i<18;i++)for(const block of blocks)block.push(code[p++]);
  const multiply=(a,b)=>{let result=0;while(b){if(b&1)result^=a;a=a&128?(a<<1)^285:a<<1;b>>=1;}return result;};
  for(const block of blocks){let root=1;for(let i=0;i<18;i++){assert.equal(block.reduce((sum,b)=>multiply(sum,root)^b,0),0,'invalid ECC');root=multiply(root,2);}}
  const bits=data.flatMap(byte=>Array.from({length:8},(_,i)=>(byte>>(7-i))&1));
  let cursor=0;const take=count=>{let v=0;while(count--)v=v*2+bits[cursor++];return v;};
  assert.equal(take(4),4);const length=take(16);return new TextDecoder().decode(Uint8Array.from({length},()=>take(8)));
}
test('offline QR encodes the exact complete read-only presentation URL with valid ECC',()=>{
  const link=`https://solodevfailure.github.io/Dungeons-and-Daiquiris/presentation.html#session=24aa54ee-3fb7-4b31-96f0-0fd219a07bc8&view=${'a'.repeat(64)}`;
  assert.equal(decode(D.qr.matrix(link)),link);
});
test('QR capacity and Unicode byte counts are correct',()=>{
  for(const text of ['Pair once','abomination \u{1f379}','x'.repeat(271)])assert.equal(decode(D.qr.matrix(text)),text);
  assert.throws(()=>D.qr.matrix('x'.repeat(272)),/too long/);
});
