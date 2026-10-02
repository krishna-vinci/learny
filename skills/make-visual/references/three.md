# Three 0.186.1 (bundled browser global, lazy)

Declare `libs:["three"]` only when depth/orbit teaches the concept; use 2-D first.

Needed APIs: Scene, PerspectiveCamera/OrthographicCamera, Vector3, Matrix4,
BufferGeometry, Float32BufferAttribute, BoxGeometry, SphereGeometry,
MeshBasicMaterial, MeshStandardMaterial, Mesh, Line/LineBasicMaterial,
AmbientLight/DirectionalLight, WebGLRenderer.

```js
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(45,1,0.1,100);camera.position.z=6;
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
let mesh;
document.addEventListener('DOMContentLoaded',()=>{
  const el=document.getElementById('studium-stage');el.append(renderer.domElement);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const resize=()=>{renderer.setSize(el.clientWidth,el.clientHeight);camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();};
  new ResizeObserver(resize).observe(el);resize();
  mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:studium.palette[0]}));scene.add(mesh);
});
studium.mount({scenes:[{state:{angle:0},narration:'Start facing the object.'},{state:{angle:0.8},narration:'Turn to reveal its depth.'}],draw:({state,theme})=>{if(!mesh)return;mesh.rotation.y=state.angle||0;mesh.material.color.set(studium.palette[0]);renderer.setClearColor(0x000000,0);renderer.render(scene,camera);}});
window.addEventListener('pagehide',()=>{mesh?.geometry.dispose();mesh?.material.dispose();renderer.dispose();});
```

No setAnimationLoop, private requestAnimationFrame, TextureLoader/remote resources,
CDN addons or OrbitControls imports. Use touch pointer events for needed manipulation.
Keep annotations in SVG/HTML and author static SVG posters for the book.
