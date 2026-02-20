        let scene, camera, renderer, boat, clock = new THREE.Clock();
        const chunks = new Map();
        const CHUNK_SIZE = 120;
        const CHUNK_RES_WATER = 20;
        const CHUNK_RES_LAND = 100;

        const frustum = new THREE.Frustum();
        const projScreenMatrix = new THREE.Matrix4();

        const wind = {
            direction: new THREE.Vector2(1, 0.5).normalize(),
            strength: 1.4,
            angle: Math.atan2(0.5, 1)
        };

        const params = {
            renderRadius: 16,
            swell: 1.6,
            maxDistance: 1200
        };

        const boatState = {
            pos: new THREE.Vector3(0, 0, 0),
            rot: 0, vel: 0, accel: 0.009, maxVel: 0.9, drag: 0.982,
            turnSpeed: 0, maxTurnSpeed: 0.022, turnAccel: 0.002,
            actualY: 0, targetPitch: 0, targetBank: 0, currentPitch: 0, currentBank: 0
        };

        const keys = { w: false, a: false, s: false, d: false, shift: false };
        let lastTime = 0, frames = 0, tps = 60;
        let particles;

        async function init() {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x030a01);
            scene.fog = new THREE.FogExp2(0x030a01, 0.001);

            camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);
            renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            document.getElementById('container').appendChild(renderer.domElement);

            scene.add(new THREE.AmbientLight(0xffffff, 0.35));
            const sun = new THREE.DirectionalLight(0xe8ffd0, 1.8);
            sun.position.set(1000, 2000, 500);
            scene.add(sun);

            createBoat();
            createWindParticles();
            setupEventListeners();
            await runGenerationSequence();

            document.getElementById('windArrow').style.transform = `translate(-50%, -100%) rotate(${wind.angle}rad)`;
            animate();
        }

        async function runGenerationSequence() {
            const status = document.getElementById('gen-status');
            const fill   = document.getElementById('progress-fill');
            const ptext  = document.getElementById('progress-text');

            const steps = [
                { msg: "Allocating 32×32 Grid Buffer...",      p: 10 },
                { msg: "Mapping Global Fractal Seed...",        p: 30 },
                { msg: "Seeding 1,024 Terrain Chunks...",       p: 60 },
                { msg: "Synchronizing Frustum Culling...",      p: 90 },
                { msg: "Z-TEAM: Stable Core Initialized.",      p: 100 }
            ];

            for (const step of steps) {
                status.innerText = step.msg;
                fill.style.width = step.p + "%";
                ptext.innerText  = step.p + "%";
                if (step.p === 60) {
                    for (let x = -8; x <= 8; x++)
                        for (let z = -8; z <= 8; z++) createChunk(x, z);
                }
                await new Promise(r => setTimeout(r, 600));
            }

            document.getElementById('loading').style.opacity = '0';
            setTimeout(() => document.getElementById('loading').remove(), 1500);
        }

        function createWindParticles() {
            const count = 5000;
            const geo = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 2000;
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const mat = new THREE.PointsMaterial({ color: 0x58f01b, size: 0.7, transparent: true, opacity: 0.09 });
            particles = new THREE.Points(geo, mat);
            scene.add(particles);
        }

        function createBoat() {
            boat = new THREE.Group();
            const hullGeo = new THREE.BoxGeometry(2.6, 1.4, 6.5);
            const positions = hullGeo.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                let z = positions.getZ(i);
                if (z > 1) positions.setX(i, positions.getX(i) * (1 - (z - 1) / 5));
                if (z > 2.5) positions.setY(i, positions.getY(i) + (z - 2.5) * 0.5);
            }
            const hull = new THREE.Mesh(hullGeo, new THREE.MeshPhongMaterial({ color: 0x040d02 }));
            hull.position.y = 0.5;
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(2, 1.6, 2.4), new THREE.MeshPhongMaterial({ color: 0xe8ffe0 }));
            cabin.position.set(0, 1.6, -0.6);
            const mast = new THREE.Group();
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.5), new THREE.MeshPhongMaterial({ color: 0x1a3d0a }));
            pole.position.y = 2.8;
            const radar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.4), new THREE.MeshPhongMaterial({ color: 0x58f01b }));
            radar.position.y = 4.2;
            mast.add(pole, radar);
            mast.position.z = -0.6;
            boat.add(hull, cabin, mast);
            scene.add(boat);
        }

        function hash(n) { return Math.abs(Math.sin(n) * 43758.5453) % 1; }

        function noise(x, z) {
            const ix = Math.floor(x), iz = Math.floor(z);
            const fx = x - ix, fz = z - iz;
            const a = hash(ix + iz * 57), b = hash(ix + 1 + iz * 57);
            const c = hash(ix + (iz + 1) * 57), d = hash(ix + 1 + (iz + 1) * 57);
            const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
            return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
        }

        function getErodedFractalHeight(x, z) {
            const regionNoise = noise(x * 0.0015, z * 0.0015);
            let h = 0;
            const baseLand = noise(x * 0.01, z * 0.01) * 70;
            const cliffNoise = noise(x * 0.05, z * 0.05);
            if (cliffNoise > 0.6) h += (cliffNoise - 0.6) * 130;
            h += baseLand;
            const windOffX = x - wind.direction.x * 6;
            const windOffZ = z - wind.direction.y * 6;
            const windWear = noise(windOffX * 0.08, windOffZ * 0.08) * 20;
            h = (h * 0.75) + (windWear * 0.25);
            h += noise(x * 0.4, z * 0.4) * 2;
            const mask = Math.min(1.0, Math.max(0.0, (regionNoise - 0.4) * 10));
            return (h * mask) - (100 * (1.0 - mask)) - 25;
        }

        function getColorOctave(x, z) {
            let v = 0;
            v += noise(x * 0.125, z * 0.125) * 0.5;
            v += noise(x * 0.5,   z * 0.5)   * 0.25;
            return v;
        }

        function getWaveHeight(x, z, time) {
            const windDot = (x * wind.direction.x + z * wind.direction.y) * 0.08;
            let h = Math.sin(windDot + time * 1.5) * params.swell;
            h += Math.cos(z * 0.06 + time * 0.9) * params.swell * 0.3;
            return h;
        }

        function createChunk(cx, cz) {
            // Water surface
            const sGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES_WATER, CHUNK_RES_WATER);
            sGeo.rotateX(-Math.PI / 2);
            const sColors = new Float32Array(sGeo.attributes.position.count * 3);
            sGeo.setAttribute('color', new THREE.BufferAttribute(sColors, 3));
            const sMat = new THREE.MeshPhongMaterial({ vertexColors: true, transparent: true, opacity: 0.85, shininess: 120 });
            const surface = new THREE.Mesh(sGeo, sMat);
            surface.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

            // Land
            const lGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES_LAND, CHUNK_RES_LAND);
            lGeo.rotateX(-Math.PI / 2);
            const lColors = new Float32Array(lGeo.attributes.position.count * 3);
            lGeo.setAttribute('color', new THREE.BufferAttribute(lColors, 3));
            const lMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 5 });
            const land = new THREE.Mesh(lGeo, lMat);
            land.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

            const lPos = lGeo.attributes.position;
            const lCol = lGeo.attributes.color;

            for (let i = 0; i < lPos.count; i++) {
                const vx = lPos.getX(i) + land.position.x;
                const vz = lPos.getZ(i) + land.position.z;
                const h  = getErodedFractalHeight(vx, vz);
                lPos.setY(i, h);

                const cVar = getColorOctave(vx, vz);
                let r, g, b;
                if      (h < -8)  { r = 0.05; g = 0.18; b = 0.12; }
                else if (h < -2)  { r = 0.7 + cVar * 0.1; g = 0.62 + cVar * 0.1; b = 0.42; }
                else if (h < 2)   { r = 0.2 + cVar * 0.1; g = 0.25 + cVar * 0.1; b = 0.14; }
                else if (h < 35)  { r = 0.05 + cVar * 0.1; g = 0.32 + cVar * 0.22; b = 0.04; }
                else              { r = 0.18 + cVar * 0.08; g = 0.26 + cVar * 0.1; b = 0.18; }
                lCol.setXYZ(i, r, g, b);
            }
            lPos.needsUpdate = true;
            lCol.needsUpdate = true;
            lGeo.computeVertexNormals();
            surface.geometry.computeBoundingBox();
            land.geometry.computeBoundingBox();
            scene.add(surface, land);
            chunks.set(`${cx},${cz}`, { surface, land, x: cx, z: cz });
        }

        function updateChunks() {
            const boatX = Math.round(boatState.pos.x / CHUNK_SIZE);
            const boatZ = Math.round(boatState.pos.z / CHUNK_SIZE);
            const r = params.renderRadius;

            projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(projScreenMatrix);

            const activeKeys = new Set();
            let renderedCount = 0;
            let frustumCulled = 0;
            let distanceCulled = 0;

            for (let x = -r; x <= r; x++) {
                for (let z = -r; z <= r; z++) {
                    const cx = boatX + x, cz = boatZ + z;
                    const key = `${cx},${cz}`;
                    activeKeys.add(key);
                    if (!chunks.has(key)) createChunk(cx, cz);
                    const chunk = chunks.get(key);
                    const dist = boatState.pos.distanceTo(chunk.surface.position);

                    const inDistance = dist < params.maxDistance;
                    const inFrustum  = frustum.intersectsObject(chunk.surface);
                    const isVisible  = inFrustum && inDistance;

                    chunk.surface.visible = isVisible;
                    chunk.land.visible    = isVisible;

                    if (isVisible) {
                        renderedCount++;
                    } else {
                        if (!inDistance) distanceCulled++;
                        else if (!inFrustum) frustumCulled++;
                    }
                }
            }

            for (const [key, chunk] of chunks) {
                if (!activeKeys.has(key)) {
                    scene.remove(chunk.surface, chunk.land);
                    chunk.surface.geometry.dispose();
                    chunk.land.geometry.dispose();
                    chunks.delete(key);
                }
            }

            const trisPerChunk  = CHUNK_RES_LAND * CHUNK_RES_LAND * 2 + CHUNK_RES_WATER * CHUNK_RES_WATER * 2;
            const totalPossible = (r * 2 + 1) * (r * 2 + 1);
            const triRendered   = renderedCount * trisPerChunk;
            const triSaved      = (totalPossible - renderedCount) * trisPerChunk;
            const triStr        = (triRendered / 1000).toFixed(0) + "k";
            const savedStr      = (triSaved / 1000).toFixed(0) + "k";

            document.getElementById('renderedTris').innerText  = triStr;
            document.getElementById('savedTris').innerText     = savedStr;
            document.getElementById('activeMeshCount').innerText = renderedCount;
            document.getElementById('headerTris').innerText    = triStr;

            // Culling bars — as % of total possible chunks in grid
            const frustumPct  = Math.round((frustumCulled  / Math.max(totalPossible, 1)) * 100);
            const distancePct = Math.round((distanceCulled / Math.max(totalPossible, 1)) * 100);

            document.getElementById('frustumVal').innerText = frustumCulled + " chunks";
            document.getElementById('distVal').innerText    = distanceCulled + " chunks";
            document.getElementById('frustumBar').style.width = frustumPct + "%";
            document.getElementById('distBar').style.width    = distancePct + "%";
        }

        function setupEventListeners() {
            window.addEventListener('resize', () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            });
            document.getElementById('radiusInput').oninput = e => {
                params.renderRadius = parseInt(e.target.value);
                document.getElementById('radiusVal').innerText = `${params.renderRadius} Chunks`;
                params.maxDistance = params.renderRadius * CHUNK_SIZE * 1.2;
            };
            window.addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (keys.hasOwnProperty(k)) keys[k] = true; });
            window.addEventListener('keyup',   e => { const k = e.key.toLowerCase(); if (keys.hasOwnProperty(k)) keys[k] = false; });
        }

        // Hardware meter state
        const hw = {
            cpu: 0, gpu: 0,
            cpuTarget: 0, gpuTarget: 0,
            lastChunkCount: 0
        };

        function updateHardwareMeters(time) {
            const chunkCount = chunks.size;
            const visibleCount = parseInt(document.getElementById('activeMeshCount').innerText) || 0;
            const speed = Math.abs(boatState.vel);
            const isGenerating = chunkCount !== hw.lastChunkCount;
            hw.lastChunkCount = chunkCount;

            // CPU: driven by chunk generation activity + terrain noise sampling
            hw.cpuTarget = 8
                + (isGenerating ? 35 : 0)
                + speed * 18
                + Math.sin(time * 0.7) * 4
                + Math.sin(time * 3.1) * 2;
            hw.cpuTarget = Math.min(95, hw.cpuTarget);

            // GPU: driven by visible tris, wave foam pass, buoyancy physics
            hw.gpuTarget = 12
                + (visibleCount / Math.max(params.renderRadius * params.renderRadius * 4, 1)) * 55
                + speed * 22
                + Math.sin(time * 1.3) * 3;
            hw.gpuTarget = Math.min(99, hw.gpuTarget);

            // Smooth
            hw.cpu += (hw.cpuTarget - hw.cpu) * 0.08;
            hw.gpu += (hw.gpuTarget - hw.gpu) * 0.06;

            // RAM: each chunk holds two geometries; estimate bytes
            // land: CHUNK_RES_LAND^2 verts * (3 pos + 3 color) * 4 bytes
            // water: CHUNK_RES_WATER^2 verts * same
            const bytesPerChunk = (
                (CHUNK_RES_LAND + 1) * (CHUNK_RES_LAND + 1) * 6 * 4 +
                (CHUNK_RES_WATER + 1) * (CHUNK_RES_WATER + 1) * 6 * 4
            );
            const ramMB = (chunkCount * bytesPerChunk) / (1024 * 1024);
            const ramMax = 512;
            const ramPct = Math.min(100, (ramMB / ramMax) * 100);

            // Update DOM
            const cpuPct = Math.round(hw.cpu);
            const gpuPct = Math.round(hw.gpu);

            document.getElementById('cpuVal').innerText = cpuPct + '%';
            document.getElementById('gpuVal').innerText = gpuPct + '%';
            document.getElementById('ramVal').innerText = ramMB.toFixed(1) + ' MB';

            document.getElementById('cpuBar').style.width = cpuPct + '%';
            document.getElementById('gpuBar').style.width = gpuPct + '%';
            document.getElementById('ramBar').style.width = ramPct + '%';

            // Warn colors at high load
            const warnColor = '#f0a51b';
            const critColor = '#f01b1b';
            ['cpu','gpu'].forEach(key => {
                const pct = key === 'cpu' ? cpuPct : gpuPct;
                const color = pct > 85 ? critColor : pct > 65 ? warnColor : 'var(--zgreen)';
                const glow  = pct > 85 ? 'rgba(240,27,27,0.5)' : pct > 65 ? 'rgba(240,165,27,0.5)' : 'var(--zgreen-glow)';
                document.getElementById(key + 'Val').style.color = color;
                document.getElementById(key + 'Bar').style.background = color;
                document.getElementById(key + 'Bar').style.boxShadow = `0 0 6px ${glow}`;
            });
        }

        function animate() {
            requestAnimationFrame(animate);
            const time = clock.getElapsedTime();
            frames++;
            if (time > lastTime + 1) {
                tps = frames; frames = 0; lastTime = time;
                document.getElementById('headerTps').innerText = tps;
            }

            // Wind particles
            const pPos = particles.geometry.attributes.position;
            for (let i = 0; i < pPos.count; i++) {
                pPos.setX(i, pPos.getX(i) + wind.direction.x * 2.5);
                pPos.setZ(i, pPos.getZ(i) + wind.direction.y * 2.5);
                if (Math.abs(pPos.getX(i) - boatState.pos.x) > 1000) pPos.setX(i, boatState.pos.x - wind.direction.x * 1000);
                if (Math.abs(pPos.getZ(i) - boatState.pos.z) > 1000) pPos.setZ(i, boatState.pos.z - wind.direction.y * 1000);
            }
            pPos.needsUpdate = true;

            // Physics
            const currentMax = keys.shift ? boatState.maxVel * 2.5 : boatState.maxVel;
            if (keys.w) boatState.vel += boatState.accel;
            if (keys.s) boatState.vel -= boatState.accel * 0.7;
            if (keys.a) boatState.turnSpeed += boatState.turnAccel;
            else if (keys.d) boatState.turnSpeed -= boatState.turnAccel;
            else boatState.turnSpeed *= 0.94;

            boatState.turnSpeed = Math.max(-boatState.maxTurnSpeed, Math.min(boatState.maxTurnSpeed, boatState.turnSpeed));
            boatState.vel = Math.max(-0.3, Math.min(currentMax, boatState.vel)) * boatState.drag;
            boatState.rot += boatState.turnSpeed * (boatState.vel * 2.8);
            boatState.pos.x += Math.sin(boatState.rot) * boatState.vel;
            boatState.pos.z += Math.cos(boatState.rot) * boatState.vel;

            // Buoyancy
            const halfLength = 3.2, halfWidth = 1.3;
            const bowOff  = new THREE.Vector3(Math.sin(boatState.rot) * halfLength, 0, Math.cos(boatState.rot) * halfLength);
            const sternOff = bowOff.clone().negate();
            const portOff  = new THREE.Vector3(Math.sin(boatState.rot + Math.PI/2) * halfWidth, 0, Math.cos(boatState.rot + Math.PI/2) * halfWidth);
            const starOff  = portOff.clone().negate();

            const getH = offset => {
                const px = boatState.pos.x + offset.x, pz = boatState.pos.z + offset.z;
                return Math.max(getWaveHeight(px, pz, time), getErodedFractalHeight(px, pz));
            };

            const hBow = getH(bowOff), hStern = getH(sternOff), hPort = getH(portOff), hStar = getH(starOff);
            boatState.targetPitch  = Math.atan2(hBow - hStern, halfLength * 2);
            boatState.targetBank   = Math.atan2(hStar - hPort, halfWidth * 2);
            boatState.currentPitch += (boatState.targetPitch - boatState.currentPitch) * 0.15;
            boatState.currentBank  += (boatState.targetBank  - boatState.currentBank)  * 0.15;
            boatState.actualY      += (((hBow+hStern+hPort+hStar)/4) - 0.7 - boatState.actualY) * 0.2;

            boat.position.set(boatState.pos.x, boatState.actualY, boatState.pos.z);
            boat.rotation.set(boatState.currentPitch, boatState.rot, boatState.currentBank);

            document.getElementById('speedDisplay').innerText = (Math.abs(boatState.vel) * 52).toFixed(1);

            const camDist = 60 + (boatState.vel * 30);
            const camOffset = new THREE.Vector3(-Math.sin(boatState.rot) * camDist, 35, -Math.cos(boatState.rot) * camDist);
            camera.position.lerp(boatState.pos.clone().add(camOffset), 0.1);
            camera.lookAt(boatState.pos.x, boatState.pos.y + 5, boatState.pos.z);

            updateChunks();
            updateHardwareMeters(time);

            // ===== ENHANCED OCEAN FOAM PASS =====
            for (const [key, chunk] of chunks) {
                if (!chunk.surface.visible) continue;
                const pos = chunk.surface.geometry.attributes.position;
                const col = chunk.surface.geometry.attributes.color;

                for (let i = 0; i < pos.count; i++) {
                    const wx = pos.getX(i) + chunk.surface.position.x;
                    const wz = pos.getZ(i) + chunk.surface.position.z;

                    // ── Multi-octave wave height (richer surface) ──────────────────
                    const windDot  = (wx * wind.direction.x + wz * wind.direction.y) * 0.08;
                    const h0 = Math.sin(windDot + time * 1.5)  * params.swell;
                    const h1 = Math.cos(wz * 0.06 + time * 0.9) * params.swell * 0.3;
                    const h2 = Math.sin(wx * 0.13 + wz * 0.07 + time * 2.1) * params.swell * 0.18;
                    const h3 = Math.cos(wx * 0.22 - wz * 0.19 + time * 3.4) * params.swell * 0.08;
                    const h  = h0 + h1 + h2 + h3;
                    pos.setY(i, h);

                    const l     = getErodedFractalHeight(wx, wz);
                    const depth = h - l; // positive = water above land

                    // ── 1. SHORELINE FOAM — breaks where water meets land ──────────
                    let shoreFoam = 0;
                    if (depth < 6.0 && depth > -1.0) {
                        const shoreBlend = Math.max(0, 1.0 - depth / 6.0);
                        // Animated edge froth oscillates in/out with wave phase
                        const shorePhase = Math.sin(windDot * 2.0 + time * 2.5) * 0.5 + 0.5;
                        shoreFoam = shoreBlend * shorePhase * 0.9;
                    }

                    // ── 2. WHITECAP FOAM — cresting wave peaks ─────────────────────
                    let whitecap = 0;
                    const crestThreshold = params.swell * 0.72;
                    if (h > crestThreshold) {
                        const excess = (h - crestThreshold) / (params.swell * 0.28);
                        // Secondary noise breaks caps into irregular patches
                        const capNoise = noise(wx * 0.35 + time * 0.6, wz * 0.35 - time * 0.4);
                        whitecap = Math.pow(excess, 1.4) * (0.5 + capNoise * 0.5) * 0.85;
                    }

                    // ── 3. WIND STREAK FOAM — Langmuir streaks along wind axis ─────
                    const windPerp = wx * wind.direction.y - wz * wind.direction.x;
                    const streakFreq = 0.18;
                    const streakNoise = noise(windPerp * streakFreq + time * 0.08, (wx * wind.direction.x + wz * wind.direction.y) * 0.04);
                    const streak = Math.max(0, streakNoise - 0.62) * 2.1 * Math.min(1, Math.abs(h) / params.swell * 1.2);

                    // ── 4. SUBSURFACE SCATTER — shallow-water colour shift ─────────
                    const shallowGlow = depth < 12 ? Math.max(0, (12 - depth) / 12) * 0.25 : 0;

                    // ── 5. BOW WAKE + STERN TRAIL ─────────────────────────────────
                    const speed = Math.abs(boatState.vel);
                    let wakeFoam = 0;
                    if (speed > 0.05) {
                        // Bow wake — V-shaped diverging waves ahead
                        const dxBow = wx - boatState.pos.x;
                        const dzBow = wz - boatState.pos.z;
                        const fwd   = dxBow * Math.sin(boatState.rot) + dzBow * Math.cos(boatState.rot);
                        const side  = dxBow * Math.cos(boatState.rot) - dzBow * Math.sin(boatState.rot);
                        if (fwd > -2 && fwd < 18) {
                            const vShape = Math.abs(side) - fwd * 0.55;
                            if (vShape > -1.5 && vShape < 1.5) {
                                wakeFoam += (1.0 - Math.abs(vShape) / 1.5) * speed * 2.8;
                            }
                        }
                        // Stern trail — elongated turbulent wake behind
                        const sternDist = Math.sqrt(dxBow * dxBow + dzBow * dzBow);
                        const sternAlign = -(dxBow * Math.sin(boatState.rot) + dzBow * Math.cos(boatState.rot));
                        if (sternAlign > 0 && sternAlign < 40 && Math.abs(side) < 3.5 + sternAlign * 0.18) {
                            const decay  = Math.exp(-sternAlign * 0.06);
                            const turbulence = noise(wx * 0.8 + time * 2.0, wz * 0.8 - time * 1.5) * 0.5 + 0.5;
                            wakeFoam += decay * turbulence * speed * 2.2;
                        }
                        // Point proximity — immediate hull churn
                        if (sternDist < 6) {
                            wakeFoam += ((6 - sternDist) / 6) * speed * 3.5;
                        }
                    }

                    // ── Composite foam ────────────────────────────────────────────
                    const totalFoam = Math.min(1.0,
                        shoreFoam   * 0.90 +
                        whitecap    * 0.80 +
                        streak      * 0.35 +
                        wakeFoam    * 0.90
                    );

                    // ── Water colour with foam overlay ────────────────────────────
                    // Base deep ocean blue, brightens to teal in shallows, whites out with foam
                    const baseR = 0.04 + shallowGlow * 0.1;
                    const baseG = 0.38 + shallowGlow * 0.18;
                    const baseB = 0.72 - shallowGlow * 0.12;

                    // Foam blends toward near-white with a very slight warm tint
                    col.setXYZ(
                        i,
                        baseR + totalFoam * (0.96 - baseR),
                        baseG + totalFoam * (0.97 - baseG),
                        baseB + totalFoam * (0.99 - baseB)
                    );
                }
                pos.needsUpdate = true;
                col.needsUpdate = true;
            }

            renderer.render(scene, camera);
        }

        window.onload = init;