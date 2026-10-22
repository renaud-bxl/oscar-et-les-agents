import test from 'node:test';
import assert from 'node:assert/strict';
import {fitOfficeViewport,PixelWorld} from '../public/pixel-world.js';

test('the complete room stays between the header and dock on square, wide and phone screens',()=>{
  for(const [width,height,top,bottom] of [[1024,1024,116,112],[1920,1080,108,112],[2560,1440,108,112],[3440,1440,108,112],[844,390,100,88],[390,844,206,228]]) {
    const v=fitOfficeViewport({width,height,top,bottom,left:12,right:12,dpr:2});
    const edges={left:v.offsetX,right:v.offsetX+1440*v.scale,top:v.offsetY,bottom:v.offsetY+850*v.scale};
    assert.ok(edges.left>=12-.001&&edges.right<=width-12+.001,`${width}: room sides clipped`);
    assert.ok(edges.top>=top-.001&&edges.bottom<=height-bottom+.001,`${width}: room hidden behind navigation`);
    // Window tops, all twenty seats, lounge furniture and its bottom label.
    for(const [x,y] of [[180,60],[1300,194],[210,490],[450,750],[1130,750],[608,807],[852,833]]) {
      const screen={x:v.offsetX+x*v.scale,y:v.offsetY+y*v.scale};
      assert.ok(screen.x>=0&&screen.x<=width&&screen.y>=top&&screen.y<=height-bottom);
    }
  }
});

test('widening a landscape window never enlarges the room past the available height',()=>{
  const frames=[1600,1920,2560,3440].map(width=>fitOfficeViewport({width,height:1000,top:108,bottom:112}));
  for(const v of frames)assert.equal(v.scale,780/850);
  assert.ok(frames.at(-1).offsetX>frames[0].offsetX,'the extra width belongs to the surrounding scenery');
  const invalid=fitOfficeViewport({width:0,height:NaN,top:Infinity,bottom:-5,dpr:Infinity});
  assert.ok(invalid.scale>0&&Object.values(invalid).filter(value=>typeof value==='number').every(Number.isFinite));
});

test('resizing measures real navigation bounds and keeps clicks aligned with the fitted room',t=>{
  const before=globalThis.window;globalThis.window={devicePixelRatio:2};
  t.after(()=>{if(before===undefined)delete globalThis.window;else globalThis.window=before;});
  let headerBottom=110,dockTop=900,draws=0;
  const chrome=(kind,rect)=>({classList:{contains:value=>value===kind},getBoundingClientRect:rect});
  const canvas={width:0,height:0,getBoundingClientRect:()=>({left:20,top:30,width:1920,height:1000})};
  const world=Object.create(PixelWorld.prototype);
  Object.assign(world,{canvas,pixelRatio:2,ctx:{},_background:{},_draw:()=>draws++,
    _viewportChrome:[chrome('office-hud',()=>({width:1800,height:80,bottom:headerBottom})),chrome('office-dock',()=>({width:1000,height:90,top:dockTop}))]});
  world._resizeViewport();
  assert.equal(world.viewport.insets.top,92);assert.equal(world.viewport.insets.bottom,142);
  assert.equal(canvas.width,3840);assert.equal(canvas.height,2000);
  const click=point=>world._coordinates({clientX:20+world.viewport.offsetX+point.x*world.viewport.scale,clientY:30+world.viewport.offsetY+point.y*world.viewport.scale});
  for(const target of [{x:1160,y:240},{x:280,y:227},{x:1324,y:580}]) {
    const result=click(target);assert.ok(Math.abs(result.x-target.x)<1e-8&&Math.abs(result.y-target.y)<1e-8);
  }
  headerBottom=160;dockTop=850;world._resizeViewport();
  assert.equal(world.viewport.insets.top,142);assert.equal(world.viewport.insets.bottom,192);assert.equal(draws,2);
});

test('very short windows keep the decorative grid bounded instead of freezing the office',()=>{
  const world=Object.create(PixelWorld.prototype),ctx={createLinearGradient:()=>({addColorStop(){}}),fillRect(){}};
  for(const frame of [{width:390,height:360,top:206,bottom:228},{width:844,height:280,top:108,bottom:172},{width:3840,height:2160,top:108,bottom:112}]) {
    let lines=0;world._theme='dark';world.viewport=fitOfficeViewport(frame);
    world._line=()=>{lines++;if(lines>6500)throw Error('Decorative grid exceeded the frame budget');};
    world._drawViewportBackdrop(ctx);assert.ok(lines>2&&lines<=6500,JSON.stringify({frame,lines}));
  }
});
