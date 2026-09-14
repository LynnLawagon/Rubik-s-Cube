(function(){

  // ---------- constants ----------
  const CUBIE = 1;
  const GAP = 0.045;
  const SPACING = CUBIE + GAP;
  const DRAG_THRESHOLD = 6;
  const ORBIT_SENS = 0.008;

  const COLORS = { U:0xf5f2ea, D:0xf2c14e, F:0x3fae67, B:0x3f6fd6, R:0xd6432f, L:0xf07a20 };
  const FACE_COLOR_KEY = { 'x+':'R', 'x-':'L', 'y+':'U', 'y-':'D', 'z+':'F', 'z-':'B' };

  // ---------- scene setup ----------
  const container = document.getElementById('canvas-container');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(4.6, 4.2, 6.4);
  camera.lookAt(0,0,0);

  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff3df, 0.95); key.position.set(5,8,6); scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.35); fill.position.set(-6,-2,-4); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25); rim.position.set(-4,5,-6); scene.add(rim);

  const puzzleGroup = new THREE.Group();
  puzzleGroup.rotation.x = -0.35;
  puzzleGroup.rotation.y = 0.55;
  scene.add(puzzleGroup);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- helpers ----------
  function axisUnitVector(name){
    if(name==='x') return new THREE.Vector3(1,0,0);
    if(name==='y') return new THREE.Vector3(0,1,0);
    return new THREE.Vector3(0,0,1);
  }
  function axisFromVector(v){
    const ax=Math.abs(v.x), ay=Math.abs(v.y), az=Math.abs(v.z);
    if(ax>=ay && ax>=az) return { name:'x', sign: v.x>=0?1:-1 };
    if(ay>=ax && ay>=az) return { name:'y', sign: v.y>=0?1:-1 };
    return { name:'z', sign: v.z>=0?1:-1 };
  }
  function projectToScreen(v){
    const p = v.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x:(p.x+1)/2*rect.width + rect.left, y:(-p.y+1)/2*rect.height + rect.top };
  }

  // ---------- cube construction ----------
  let cubieGroups = [];
  let cubieMeshes = [];
  let allStickers = [];

  function addStickerIfNeeded(group, axisName, sign, size){
    if (group.userData.grid[axisName] !== sign) return;
    const faceKey = axisName + (sign>0?'+':'-');
    const colorKey = FACE_COLOR_KEY[faceKey];
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS[colorKey], roughness:0.45, metalness:0.02 });
    const sticker = new THREE.Mesh(geo, mat);
    sticker.userData.colorKey = colorKey;
    const localNormal = axisUnitVector(axisName).multiplyScalar(sign);
    const offset = CUBIE/2 + 0.011;
    sticker.position.copy(localNormal.clone().multiplyScalar(offset));
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), localNormal);
    sticker.quaternion.copy(quat);
    group.add(sticker);
    allStickers.push(sticker);
  }

  function createCubie(x,y,z){
    const group = new THREE.Group();
    group.userData.grid = { x, y, z };
    const boxGeo = new THREE.BoxGeometry(CUBIE*0.98, CUBIE*0.98, CUBIE*0.98);
    const boxMat = new THREE.MeshStandardMaterial({ color:0x0d0d12, roughness:0.65, metalness:0.05 });
    const box = new THREE.Mesh(boxGeo, boxMat);
    group.add(box);
    cubieMeshes.push(box);
    const size = CUBIE * 0.8;
    [['x',1],['x',-1],['y',1],['y',-1],['z',1],['z',-1]].forEach(([a,s]) => addStickerIfNeeded(group, a, s, size));
    group.position.set(x*SPACING, y*SPACING, z*SPACING);
    return group;
  }

  function buildCube(){
    for(let x=-1;x<=1;x++)
      for(let y=-1;y<=1;y++)
        for(let z=-1;z<=1;z++){
          const g = createCubie(x,y,z);
          cubieGroups.push(g);
          puzzleGroup.add(g);
        }
  }
  buildCube();

  // ---------- move queue / animation ----------
  const queue = [];
  let moveInProgress = null;

  function queueMove(m){ queue.push(m); }

  function startTwistExec(m){
    const affected = cubieGroups.filter(c => Math.round(c.userData.grid[m.axisName]) === m.layerValue);
    const pivot = new THREE.Group();
    puzzleGroup.add(pivot);
    affected.forEach(c => pivot.attach(c));
    moveInProgress = Object.assign({}, m, { affected, pivot, elapsed:0 });
  }

  function finalizeMove(m){
    m.affected.forEach(c => {
      puzzleGroup.attach(c);
      const v = new THREE.Vector3(c.userData.grid.x, c.userData.grid.y, c.userData.grid.z);
      v.applyAxisAngle(m.axisVec, m.angle);
      c.userData.grid = { x:Math.round(v.x), y:Math.round(v.y), z:Math.round(v.z) };
    });
    puzzleGroup.remove(m.pivot);
    if(!m.isScramble){
      moveCount++;
      updateHud();
      if(!timerRunning) startTimer();
      checkSolved();
    }
  }

  // ---------- HUD / timer ----------
  let moveCount = 0;
  let timerRunning = false, timerStart = 0, timerHandle = null, alreadySolved = false;

  function updateHud(){ document.getElementById('moveCount').textContent = moveCount; }

  function startTimer(){
    timerRunning = true;
    timerStart = performance.now();
    timerHandle = setInterval(updateTimerDisplay, 250);
  }
  function stopTimer(){
    timerRunning = false;
    clearInterval(timerHandle);
  }
  function formatTime(ms){
    const secs = Math.floor(ms/1000);
    const m = String(Math.floor(secs/60)).padStart(2,'0');
    const s = String(secs%60).padStart(2,'0');
    return m+':'+s;
  }
  function updateTimerDisplay(){
    document.getElementById('timer').textContent = formatTime(performance.now()-timerStart);
  }

  function checkSolved(){
    puzzleGroup.updateMatrixWorld(true);
    const invQuat = puzzleGroup.quaternion.clone().invert();
    const buckets = {};
    allStickers.forEach(st => {
      const nm = new THREE.Matrix3().getNormalMatrix(st.matrixWorld);
      const worldNormal = new THREE.Vector3(0,0,1).applyMatrix3(nm).normalize();
      worldNormal.applyQuaternion(invQuat);
      const ax = axisFromVector(worldNormal);
      const key = ax.name + (ax.sign>0?'+':'-');
      (buckets[key] = buckets[key] || []).push(st.userData.colorKey);
    });
    const keys = Object.keys(buckets);
    const solved = keys.length===6 && keys.every(k => buckets[k].length===9 && buckets[k].every(c => c===buckets[k][0]));
    if(solved && !alreadySolved){
      alreadySolved = true;
      stopTimer();
      document.getElementById('solvedStats').textContent = moveCount + ' moves · ' + formatTime(performance.now()-timerStart);
      document.getElementById('solvedBanner').classList.add('show');
    }
  }
  function hideSolvedBanner(){
    document.getElementById('solvedBanner').classList.remove('show');
    alreadySolved = false;
  }

  // ---------- pointer interaction ----------
  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();
  let isDown=false, mode=null, axisDecided=false;
  let downX=0, downY=0, downPointWorld=null, downNormalWorld=null, hitCubie=null;

  function onPointerDown(e){
    isDown = true; downX = e.clientX; downY = e.clientY;
    const rect = renderer.domElement.getBoundingClientRect();
    mouseNDC.x = ((e.clientX-rect.left)/rect.width)*2-1;
    mouseNDC.y = -((e.clientY-rect.top)/rect.height)*2+1;
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(cubieMeshes, false);
    if(hits.length>0){
      mode='twist'; axisDecided=false;
      const hit = hits[0];
      hitCubie = hit.object.parent;
      hit.object.updateMatrixWorld();
      const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      downNormalWorld = hit.face.normal.clone().applyMatrix3(nm).normalize();
      downPointWorld = hit.point.clone();
    } else {
      mode='orbit';
    }
  }

  function decideAndTwist(dx,dy){
    const invQuat = puzzleGroup.quaternion.clone().invert();
    const localNormal = downNormalWorld.clone().applyQuaternion(invQuat);
    const normalAxis = axisFromVector(localNormal);
    const axes = ['x','y','z'].filter(a => a!==normalAxis.name);
    let bestAxis=null, bestScore=-Infinity, bestSign=1;
    const p0 = projectToScreen(downPointWorld);
    axes.forEach(axisName => {
      const worldAxisVec = axisUnitVector(axisName).applyQuaternion(puzzleGroup.quaternion);
      const p1 = projectToScreen(downPointWorld.clone().addScaledVector(worldAxisVec, 0.4));
      const sx=p1.x-p0.x, sy=p1.y-p0.y;
      const len = Math.hypot(sx,sy) || 1;
      const nx=sx/len, ny=sy/len;
      const dot = dx*nx + dy*ny;
      if(Math.abs(dot) > bestScore){ bestScore=Math.abs(dot); bestAxis=axisName; bestSign = dot>=0?1:-1; }
    });
    const rotAxisName = axes.find(a => a!==bestAxis);
    const normalVecLocal = axisUnitVector(normalAxis.name).multiplyScalar(normalAxis.sign);
    const dragVecLocal = axisUnitVector(bestAxis).multiplyScalar(bestSign);
    const rotAxisVec = new THREE.Vector3().crossVectors(normalVecLocal, dragVecLocal).normalize();
    const layerValue = Math.round(hitCubie.userData.grid[rotAxisName]);
    queueMove({ axisName: rotAxisName, layerValue, axisVec: rotAxisVec, angle: Math.PI/2, duration: 200, isScramble:false });
  }

  function onPointerMove(e){
    if(!isDown) return;
    const dx = e.clientX-downX, dy = e.clientY-downY;
    if(mode==='orbit'){
      puzzleGroup.rotation.y += dx*ORBIT_SENS;
      puzzleGroup.rotation.x += dy*ORBIT_SENS;
      puzzleGroup.rotation.x = Math.max(-1.4, Math.min(1.4, puzzleGroup.rotation.x));
      downX = e.clientX; downY = e.clientY;
    } else if(mode==='twist' && !axisDecided){
      if(Math.hypot(dx,dy) > DRAG_THRESHOLD){
        decideAndTwist(dx,dy);
        axisDecided = true;
      }
    }
  }

  function onPointerUp(){ isDown=false; mode=null; axisDecided=false; }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // ---------- keyboard moves (standard cube notation) ----------
  // Each entry: axisName/layerValue identify the slice; "normal" points the
  // way you'd look at that face to read it as a clockwise turn without Shift.
  const MOVES = {
    U: { axisName:'y', layerValue: 1, normal:new THREE.Vector3(0, 1,0) },
    D: { axisName:'y', layerValue:-1, normal:new THREE.Vector3(0,-1,0) },
    R: { axisName:'x', layerValue: 1, normal:new THREE.Vector3( 1,0,0) },
    L: { axisName:'x', layerValue:-1, normal:new THREE.Vector3(-1,0,0) },
    F: { axisName:'z', layerValue: 1, normal:new THREE.Vector3(0,0, 1) },
    B: { axisName:'z', layerValue:-1, normal:new THREE.Vector3(0,0,-1) },
    M: { axisName:'x', layerValue: 0, normal:new THREE.Vector3(-1,0,0) }, // follows L
    E: { axisName:'y', layerValue: 0, normal:new THREE.Vector3(0,-1,0) }, // follows D
    S: { axisName:'z', layerValue: 0, normal:new THREE.Vector3(0,0, 1) }, // follows F
  };

  function doKeyMove(letter, prime){
    const m = MOVES[letter];
    if(!m) return;
    const axisVec = m.normal.clone().multiplyScalar(prime ? 1 : -1);
    queueMove({ axisName:m.axisName, layerValue:m.layerValue, axisVec, angle:Math.PI/2, duration:180, isScramble:false });
  }

  window.addEventListener('keydown', (e) => {
    if(e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toUpperCase();
    if(MOVES[k]){
      e.preventDefault();
      doKeyMove(k, e.shiftKey);
    }
  });

  // ---------- scramble / reset ----------
  function scramble(){
    hideSolvedBanner();
    stopTimer();
    document.getElementById('timer').textContent = '00:00';
    moveCount = 0; updateHud();
    const axes = ['x','y','z'];
    for(let i=0;i<22;i++){
      const axisName = axes[Math.floor(Math.random()*3)];
      const layerValue = [-1,0,1][Math.floor(Math.random()*3)];
      const sign = Math.random()<0.5 ? 1 : -1;
      const axisVec = axisUnitVector(axisName).multiplyScalar(sign);
      queueMove({ axisName, layerValue, axisVec, angle: Math.PI/2, duration: 110, isScramble:true });
    }
  }

  function resetCube(){
    queue.length = 0;
    moveInProgress = null;
    cubieGroups.forEach(g => puzzleGroup.remove(g));
    cubieGroups = []; cubieMeshes = []; allStickers = [];
    buildCube();
    stopTimer();
    document.getElementById('timer').textContent = '00:00';
    moveCount = 0; updateHud();
    hideSolvedBanner();
  }

  document.getElementById('scrambleBtn').addEventListener('click', scramble);
  document.getElementById('resetBtn').addEventListener('click', resetCube);

  // ---------- keyboard legend visibility ----------
  const legendEl = document.getElementById('legend');
  const legendReopenEl = document.getElementById('legendReopenBtn');
  function hideLegend(){
    legendEl.style.display = 'none';
    legendReopenEl.style.display = 'flex';
  }
  function showLegend(){
    legendEl.style.display = 'block';
    legendReopenEl.style.display = 'none';
  }
  document.getElementById('legendHideBtn').addEventListener('click', hideLegend);
  legendReopenEl.addEventListener('click', showLegend);

  // ---------- render loop ----------
  let lastTime = performance.now();
  function animate(now){
    requestAnimationFrame(animate);
    const delta = now - lastTime; lastTime = now;

    if(!moveInProgress && queue.length>0) startTwistExec(queue.shift());

    if(moveInProgress){
      moveInProgress.elapsed += delta;
      const t = Math.min(moveInProgress.elapsed / moveInProgress.duration, 1);
      const eased = t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
      moveInProgress.pivot.quaternion.setFromAxisAngle(moveInProgress.axisVec, eased*moveInProgress.angle);
      if(t>=1){ finalizeMove(moveInProgress); moveInProgress=null; }
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

})();
