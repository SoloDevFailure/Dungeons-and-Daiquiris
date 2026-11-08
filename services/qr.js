'use strict';
(() => {
  const app=globalThis.D20;
  // QR Model 2, version 10, level L, byte mode, mask 0. Fixed size keeps the
  // offline encoder small; 271 UTF-8 bytes covers the complete pairing URL.
  function matrix(text){
    const bytes=new TextEncoder().encode(text);
    if(bytes.length>271)throw new Error('Pairing link is too long for this QR code. Use Copy Link.');
    const bits=[];const append=(value,count)=>{for(let i=count-1;i>=0;i--)bits.push((value>>>i)&1);};
    append(4,4);append(bytes.length,16);for(const byte of bytes)append(byte,8);
    append(0,Math.min(4,2192-bits.length));while(bits.length%8)bits.push(0);
    const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((n,b)=>(n<<1)|b,0));
    for(let pad=0;data.length<274;pad++)data.push(pad%2?0x11:0xec);
    function mul(a,b){let p=0;for(let i=0;i<8;i++){if(b&1)p^=a;b>>>=1;a<<=1;if(a&256)a^=0x11d;}return p;}
    let poly=[1],root=1;
    for(let i=0;i<18;i++){
      const next=Array(poly.length+1).fill(0);
      poly.forEach((coefficient,j)=>{next[j]^=coefficient;next[j+1]^=mul(coefficient,root);});poly=next;root=mul(root,2);
    }
    function ecc(block){const rem=Array(18).fill(0);for(const byte of block){const factor=byte^rem.shift();rem.push(0);for(let j=0;j<18;j++)rem[j]^=mul(poly[j+1],factor);}return rem;}
    const blocks=[];let offset=0;for(const length of [68,68,69,69]){const block=data.slice(offset,offset+length);blocks.push({data:block,ecc:ecc(block)});offset+=length;}
    const code=[];for(let i=0;i<69;i++)for(const block of blocks)if(i<block.data.length)code.push(block.data[i]);
    for(let i=0;i<18;i++)for(const block of blocks)code.push(block.ecc[i]);
    const size=57,modules=Array.from({length:size},()=>Array(size).fill(false)),reserved=Array.from({length:size},()=>Array(size).fill(false));
    const put=(x,y,value)=>{if(x>=0&&y>=0&&x<size&&y<size){modules[y][x]=Boolean(value);reserved[y][x]=true;}};
    for(let i=0;i<size;i++){put(6,i,i%2===0);put(i,6,i%2===0);}
    function finder(cx,cy){for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));put(cx+dx,cy+dy,d!==2&&d!==4);}}
    finder(3,3);finder(size-4,3);finder(3,size-4);
    for(const cy of [6,28,50])for(const cx of [6,28,50]){
      if((cx===6&&cy===6)||(cx===6&&cy===50)||(cx===50&&cy===6))continue;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)put(cx+dx,cy+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }
    // BCH format: L=01, mask=000, generator=0x537, fixed XOR mask=0x5412.
    let rem=8;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);
    const format=((8<<10)|rem)^0x5412;const f=i=>(format>>>i)&1;
    for(let i=0;i<=5;i++)put(8,i,f(i));put(8,7,f(6));put(8,8,f(7));put(7,8,f(8));
    for(let i=9;i<15;i++)put(14-i,8,f(i));
    for(let i=0;i<8;i++)put(size-1-i,8,f(i));
    for(let i=8;i<15;i++)put(8,size-15+i,f(i));put(8,size-8,true);
    let versionRem=10;for(let i=0;i<12;i++)versionRem=(versionRem<<1)^((versionRem>>>11)*0x1f25);
    const version=(10<<12)|versionRem;
    for(let i=0;i<18;i++){const a=size-11+i%3,b=Math.floor(i/3),bit=(version>>>i)&1;put(a,b,bit);put(b,a,bit);}
    let index=0;
    for(let right=size-1;right>=1;right-=2){
      if(right===6)right=5;
      for(let vertical=0;vertical<size;vertical++){
        const upward=((right+1)&2)===0;const y=upward?size-1-vertical:vertical;
        for(let j=0;j<2;j++){const x=right-j;if(reserved[y][x])continue;
          const value=index<code.length*8?((code[index>>>3]>>>(7-(index&7)))&1):0;
          modules[y][x]=Boolean(value^((x+y)%2===0?1:0));index++;
        }
      }
    }
    return modules;
  }
  function svg(text,doc=globalThis.document){
    const modules=matrix(text);const ns='http://www.w3.org/2000/svg';
    const image=doc.createElementNS(ns,'svg');image.setAttribute('viewBox','0 0 65 65');image.setAttribute('role','img');image.setAttribute('aria-label','Scan to pair the read-only iPad presentation');image.setAttribute('shape-rendering','crispEdges');
    const bg=doc.createElementNS(ns,'rect');bg.setAttribute('width','65');bg.setAttribute('height','65');bg.setAttribute('fill','#fff');image.append(bg);
    const path=doc.createElementNS(ns,'path');let d='';
    modules.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)d+=`M${x+4},${y+4}h1v1h-1z`;}));path.setAttribute('d',d);path.setAttribute('fill','#000');image.append(path);return image;
  }
  app.qr={matrix,svg};
})();
