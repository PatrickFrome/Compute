// Inspect dimensions before decoding an untrusted local image.
export function inspectRaster(bytes,{maxSide=16000,maxPixels=16000000}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length<24)throw Error('Повреждённое изображение');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width,height,type;
 const png=[137,80,78,71,13,10,26,10];
 if(png.every((v,i)=>bytes[i]===v)&&view.getUint32(8)===13&&String.fromCharCode(...bytes.slice(12,16))==='IHDR'){
  width=view.getUint32(16);height=view.getUint32(20);type='image/png';
 }else if(bytes[0]===255&&bytes[1]===216){
  let p=2;
  while(p+4<=bytes.length){
   if(bytes[p++]!==255)throw Error('Неверный JPEG');while(bytes[p]===255)p++;
   const marker=bytes[p++];if(marker===217||marker===218)break;
   if(marker===1||(marker>=208&&marker<=215))continue;
   if(p+2>bytes.length)break;const n=view.getUint16(p);if(n<2||p+n>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
    if(n<8)break;height=view.getUint16(p+3);width=view.getUint16(p+5);type='image/jpeg';break;
   }p+=n;
  }
 }
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>maxSide||height>maxSide||width*height>maxPixels)throw Error('Нужен PNG/JPEG не более 16 миллионов пикселей');
 return {width,height,type};
}
export function inspectStoredPng(data,width,height){
 if(typeof data!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error('Неверное изображение в копии');
 const raw=atob(data.slice('data:image/png;base64,'.length, 'data:image/png;base64,'.length+44));
 const header=Uint8Array.from(raw,c=>c.charCodeAt(0));
 const meta=inspectRaster(header,{maxSide:1600,maxPixels:2560000});
 if(meta.type!=='image/png'||meta.width!==width||meta.height!==height)throw Error('Размер изображения не совпадает с заголовком');
 return meta;
}
