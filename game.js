// Speed Class Multipliers
const CC_MULTIPLIERS = {
    '50cc': 0.6,
    '100cc': 0.8,
    '150cc': 1.0,
    '200cc': 1.2,
};

// Simple Mulberry32 PRNG
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

class Game {
    constructor(difficulty = 'easy', cc = '150cc') { // Accept difficulty and cc
        this.difficulty = difficulty; // Store difficulty
        this.cc = cc; // Store cc
        // console.log(`Starting game with difficulty: ${this.difficulty}, CC: ${this.cc}`);

        const ccMultiplier = CC_MULTIPLIERS[this.cc] || 1.0;

        // --- PRNG Setup ---
        const baseSeed = Date.now();
        this.playerRandom = mulberry32(baseSeed); // PRNG for player and general game events
        this.botRandomGenerators = []; // Will store PRNGs for each bot
        // --- End PRNG Setup ---

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        document.getElementById('game-container').appendChild(this.renderer.domElement);

        // Game state
        this.keys = {};
        this.touchControls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            drift: false,
            rearView: false // Added for rear view
        };
        this.speed = 0;
        // Base speeds for 150cc (these are the reference values)
        const baseMaxSpeed = 0.5; // Max arbitrary speed for 150cc
        const baseAcceleration = 0.0033; // Acceleration for 150cc
        const baseMaxSpeedKmh = 180; // Max km/h for 150cc

        // Universal conversion factor from arbitrary speed units to km/h, based on the 150cc standard.
        // (e.g., 1 arbitrary speed unit effectively equals (180km/h / 0.5 arb_units) = 360 km/h)
        this.universalKmhConversionFactor = baseMaxSpeedKmh / baseMaxSpeed;

        // Kart's physics properties for the current CC
        this.maxSpeed = baseMaxSpeed * ccMultiplier; // Max arbitrary speed for current CC
        this.acceleration = baseAcceleration * ccMultiplier; // Acceleration for current CC
        this.deceleration = 0.005; // Deceleration might not need to scale, or scale differently
        this.turnSpeed = 0.015; // Turn speed might also be independent of CC or scale differently

        // Drift and hop parameters
        this.isDrifting = false;
        this.isHopping = false;
        this.hopHeight = 0;
        this.maxHopHeight = 0.5;
        this.hopSpeed = 0.025; // Reduced from 0.05 for slower initial hop
        this.driftSpeedMultiplier = 0.7; // Reduces max speed while drifting
        this.driftTurnMultiplier = 1.5;  // Increases turn speed while drifting
        this.gravity = 0.003; // Reduced from 0.1 for slower fall
        this.verticalVelocity = 0;
        this.lastDriftState = false; // Add tracking for drift button state change
        this.canStartDrift = false;  // New flag to track if drift can be initiated
        this.driftActive = false; // New flag to track when drift effects should apply

        // Mini-turbo parameters
        this.driftTime = 0;
        this.miniTurboStage = 0; // 0: none, 1: blue spark, 2: orange spark, 3: purple spark
        this.miniTurboThresholds = [0, 1.0, 1.8, 2.8]; // Lowered thresholds slightly (was 1.2, 2.0, 3.0)
        this.miniTurboBoostDurations = [0.8, 1.5, 2.5]; // Duration in seconds for each boost level
        this.boostMultiplier = 1.5; // Fixed boost multiplier for all levels
        this.boostTime = 0;
        this.maxBoostTime = 1.0;
        this.boosting = false;

        // Visual feedback
        this.sparkColors = [new THREE.Color(0x0099ff), new THREE.Color(0xff6600), new THREE.Color(0xcc00ff)]; // Use THREE.Color

        // Speedometer element
        this.speedDisplay = document.querySelector('.speed-value');
        // The 'this.maxSpeedKmh' property is no longer directly used for speedometer calculation,
        // as speed is now converted using 'this.universalKmhConversionFactor'.
        // If needed, the actual top km/h for the current CC can be found via:
        //   this.maxSpeed * this.universalKmhConversionFactor

        // Prevent default touch behaviors - Modified to check for Eruda elements
        document.addEventListener('touchmove', (e) => {
            // Skip preventDefault if touching Eruda elements
            if (this.isErudaElement(e.target)) return;
            e.preventDefault();
        }, { passive: false });
        
        document.addEventListener('touchstart', (e) => {
            // Skip preventDefault if touching Eruda elements
            if (this.isErudaElement(e.target)) return;
            e.preventDefault();
        }, { passive: false });

        // Camera smoothing parameters
        this.cameraTargetPosition = new THREE.Vector3();
        this.cameraCurrentPosition = new THREE.Vector3();
        this.cameraLerpFactor = 0.1; // Adjust this value to change smoothing (0.01 to 0.1)
        this.lastKartPosition = new THREE.Vector3();
        this.cameraHeight = 5; // New parameter for camera height
        this.cameraDistance = -8; // New parameter for camera distance (negative for behind)
        this.isRearViewActive = false; // State for rear view camera

        // Drift Sparks Particle System
        this.driftSparks = []; // Array to hold active spark data
        this.maxSparks = 200; // Max number of spark particles
        this.sparkLifetime = 0.3; // Seconds a spark lives
        this.sparkEmitRate = 50; // Sparks per second during drift
        this.lastSparkEmitTime = 0;
        this.setupSparkParticles(); // Initialize the particle system

        // Speed transition parameters
        this.currentSpeedLimit = this.maxSpeed;
        this.targetSpeedLimit = this.maxSpeed;
        this.speedLimitLerpFactor = 0.03; // Adjusted for 1-second transition (approximately 1/60)

        // Track parameters
        this.trackLength = 130;
        this.trackWidth = 130;   // Keep outer width the same
        this.trackLengthInner = 60;
        this.trackWidthInner = 30;   // Decreased from 100 to 30
        this.racingLinePoints = []; // Array to store points defining the ideal racing line

        // Drift momentum parameters
        this.driftDirection = 0; // 1 for left, -1 for right
        this.driftMomentumTurnSpeed = 0.005;
        this.defaultDriftMomentumTurnSpeed = 0.005; // Store default value
        this.oppositeDirectionFactor = 0.001; // How much opposite direction reduces momentum (lower = more reduction)
        this.isInDriftMomentum = false;
        this.offRoadMultiplier = 0.3; // Speed multiplier when off-road
        this.impulse = new THREE.Vector3(0, 0, 0); // Impulse vector for bumps
        this.impulseDecay = 0.85; // How quickly bump effect fades

        // Item System
        this.itemTypes = ['mushroom', 'banana', 'greenShell', 'redShell', 'fakeItemBox', 'boo', 'lightningBolt'];
        this.itemBoxes = [];
        this.itemBoxMeshes = []; // Store the visual meshes separately
        this.itemBoxRespawnTime = 8.0; // Seconds for item box to respawn
        
        // Active Items Storage
        this.droppedBananas = []; // Store active banana objects {mesh, owner}
        this.activeGreenShells = []; // {mesh, velocity, owner, bouncesLeft, lifetime}
        this.activeRedShells = []; // {mesh, target, owner, lifetime, speed}
        this.droppedFakeItemBoxes = []; // {mesh, owner}

        // Player Item State
        this.playerItem = null;
        this.playerStunDuration = 0;
        this.playerMushroomBoostDuration = 0;
        this.playerIsInvisible = false; // For Boo
        this.playerInvisibilityDuration = 0; // For Boo
        this.playerIsAttemptingBooSteal = false; // For Boo steal attempt after invisibility
        this.playerShrinkDuration = 0; // For Lightning
        this.originalPlayerScale = new THREE.Vector3(1, 1, 1); // Store original scale

        // Item Effect Constants
        this.bananaStunTime = 1.0;
        this.mushroomBoostMultiplier = 1.5;
        this.mushroomBoostTime = 2.0;
        // this.greenShellSpeed = 0.3; // Speed is now dynamic: this.maxSpeed * 1.5
        this.greenShellBounces = 3;
        this.greenShellLifetime = 7.0; // seconds
        this.greenShellStunTime = 1.0;
        this.redShellStunTime = 1.2; // Red shells might stun slightly longer
        // this.redShellSpeed = 0.25; // Red shell speed will now be dynamic, like green shells
        this.redShellLifetime = 8.0; // seconds
        this.fakeItemBoxStunTime = 0.5; // Shorter stun
        this.booDuration = 5.0;
        this.lightningShrinkDuration = 4.0;
        this.lightningShrinkScaleFactor = 0.5;
        this.lightningStunTime = 0.8; // Initial stun when hit by lightning

        // Lap counting system
        this.currentLap = 1;
        this.maxLaps = 7; // Changed to 7 laps
        this.checkpointsPassed = 0;
        this.totalCheckpoints = 4; // We'll divide track into 4 sectors
        this.lastCheckpoint = -1;
        this.checkpoints = []; // Will store checkpoint coordinates
        this.raceFinished = false;
        this.gameState = 'countdown'; // Add game state: 'countdown', 'racing', 'finished'
        this.countdownValue = 3;
        this.bots = []; // Array to hold bot objects
        this.playerPosition = 1; // Initialize player position
        this.frameCount = 0; // Frame counter for throttling logs

        // Wall properties
        this.wallMeshes = [];
        this.raycaster = new THREE.Raycaster();
        this.WALL_HEIGHT = 3.0;
        this.WALL_THICKNESS = 1.0; // Increased thickness for better visibility/collision
        this.WALL_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8, metalness: 0.2 });
        this.kartRadius = 1.0; // Approximate radius for kart collision


        // UI Elements
        this.lapDisplay = document.querySelector('.lap-counter');
        this.positionDisplay = document.querySelector('.position-display');
        this.countdownDisplay = document.getElementById('countdown-display');
        this.itemDisplay = document.getElementById('item-display'); // Get item display element
        this.itemNameDisplay = document.getElementById('item-name'); // Get inner span for item name/icon
        this.useItemButton = document.getElementById('use-item-button'); // Get use item button
        this.rearViewButton = document.getElementById('rear-view-button'); // Get rear view button
        this.updateLapCounter();
        this.updateScoreboard();
        this.updateItemDisplay(); // Initial update for item display

        // Defer some setup until OBJ model is loaded in setupScene
        this.setupSceneAndStart();
    }

    async setupSceneAndStart() {
        try {
            await this.setupScene(); // setupScene will now handle kart loading
            
            // These must run after this.kart is loaded and scene is partially set up
            this.createBots(3);
            // Store original scale for player kart after it's loaded and potentially scaled
            if (this.kart) {
                this.kart.getWorldScale(this.originalPlayerScale);
            }
            // Store original scale for bots (already done in createBots if their geometry is simple)
            this.bots.forEach(bot => {
                if (bot.mesh.isMesh) { // Simple box bots
                     bot.mesh.getWorldScale(bot.originalScale);
                } else { // If bots were also complex models
                    bot.mesh.getWorldScale(bot.originalScale);
                }
            });


            this.createItemBoxes();
            this.setupControls();
            this.startCountdown();
        } catch (error) {
            console.error("Error during scene setup and start:", error);
            // Handle error, maybe show a message to the user
        }
    }
    
    // Helper function to check if an element is part of Eruda
    isErudaElement(element) {
        if (!element) return false;
        
        // Check if the element or any parent has eruda-related class
        let current = element;
        while (current) {
            // Check for common Eruda class names or IDs
            if (current.className && 
                (typeof current.className === 'string' && 
                 (current.className.includes('eruda') || 
                  current.id === 'eruda' ||
                  current.getAttribute('data-eruda')))) {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }

    setupScene() {
        return new Promise((resolve, reject) => {
            // Create larger ground
            const groundGeometry = new THREE.PlaneGeometry(400, 400);
            const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x00aa00, side: THREE.DoubleSide });
            this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
            this.ground.rotation.x = Math.PI / 2;
            this.scene.add(this.ground);

            // Create race track (which now also creates walls and checkpoints)
            this.createRaceTrack(); // This also calls createCheckpoints internally

            // Load player kart model and texture
            const textureLoader = new THREE.TextureLoader();
            const objLoader = new THREE.OBJLoader();

            textureLoader.load(
                '/Shaded/shaded.png', // Path to the texture file
                (texture) => {
                    // Texture loaded successfully
                    this.playerKartTexture = texture; // Store the loaded texture for bots

                    objLoader.load(
                        '/Shaded/base.obj', // Path to your OBJ file
                        (object) => {
                            this.kart = object;

                            // --- Apply transformations and material to the loaded kart ---
                            const desiredHeight = 1.0; // Target height for the kart
                            const boundingBox = new THREE.Box3().setFromObject(this.kart);
                            const currentSize = new THREE.Vector3();
                            boundingBox.getSize(currentSize);
                            
                            let scaleFactor = 1;
                            if (currentSize.y > 0.001) {
                                scaleFactor = desiredHeight / currentSize.y;
                            } else if (currentSize.x > 0.001) {
                                scaleFactor = 1.0 / currentSize.x;
                            } else {
                                scaleFactor = 0.1;
                            }

                            this.kart.scale.set(scaleFactor, scaleFactor, scaleFactor);
                            
                            // Apply the loaded texture using MeshBasicMaterial
                            // If the texture is just a color map for a PBR workflow and the model has normals,
                            // you might prefer MeshStandardMaterial:
                            // const kartMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.3 });
                            const kartMaterial = new THREE.MeshBasicMaterial({ map: texture });
                            
                            this.kart.traverse((child) => {
                                if (child.isMesh) {
                                    child.material = kartMaterial;
                                    child.castShadow = true; 
                                    child.receiveShadow = true; 
                                }
                            });

                            this.scene.add(this.kart);
                            // --- End Kart Model Setup ---

                    // Define start parameters based on the first checkpoint
                    const newStartCheckpoint = this.checkpoints[0];
                    const startParams = { x: newStartCheckpoint.position.x, z: newStartCheckpoint.position.z, rotation: newStartCheckpoint.rotation };
                    const startOffsetDistance = 3.0;

                    const forwardVector = new THREE.Vector3(Math.sin(startParams.rotation), 0, Math.cos(startParams.rotation));
                    const finalStartPosition = new THREE.Vector3(
                        startParams.x + forwardVector.x * startOffsetDistance,
                        0.25, // Initial height, model pivot might affect this
                        startParams.z + forwardVector.z * startOffsetDistance
                    );

                    this.kart.position.copy(finalStartPosition);
                     // Adjust position based on the model's actual bounding box bottom
                    const newBoundingBox = new THREE.Box3().setFromObject(this.kart);
                    this.kart.position.y -= newBoundingBox.min.y; // Align bottom of kart with track (0) + 0.25 clearance


                    this.kart.rotation.y = startParams.rotation + Math.PI; // Face away from checkpoint

                    // Position camera initially
                    this.updateCamera();
                    this.camera.position.copy(this.cameraTargetPosition);
                    this.camera.lookAt(this.kart.position);
                    
                            // console.log("Player kart model loaded and textured.");
                            resolve(); // Resolve the promise once model is loaded and scene setup
                        },
                        undefined, // onProgress for OBJ
                        (error) => {
                            console.error('An error happened while loading the OBJ model:', error);
                            reject(error); // Reject if OBJ loading fails
                        }
                    );
                },
                undefined, // onProgress for texture
                (error) => {
                    console.error('An error happened while loading the texture:', error);
                    // Fallback: Load OBJ with default material if texture fails, or reject
                    // For simplicity, we'll try to load the OBJ with a basic material
                    // Player kart texture is not available here, so bots will also use default material if this path is taken.
                    this.playerKartTexture = null; // Explicitly set to null if texture loading failed.

                    objLoader.load(
                        '/Shaded/base.obj',
                        (object) => {
                            this.kart = object;
                            // Apply basic material as fallback
                            const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x800080, roughness:0.6, metalness: 0.3});
                            this.kart.traverse((child) => { if (child.isMesh) child.material = fallbackMaterial; });
                            
                            // Apply scale etc.
                            const desiredHeight = 1.0; 
                            const boundingBox = new THREE.Box3().setFromObject(this.kart);
                            const currentSize = new THREE.Vector3();
                            boundingBox.getSize(currentSize);
                            let scaleFactor = (currentSize.y > 0.001) ? desiredHeight / currentSize.y : 0.1;
                            this.kart.scale.set(scaleFactor, scaleFactor, scaleFactor);

                            this.scene.add(this.kart);

                            // Position fallback kart (copied from original fallback)
                            const newStartCheckpoint = this.checkpoints[0];
                            const startParams = { x: newStartCheckpoint.position.x, z: newStartCheckpoint.position.z, rotation: newStartCheckpoint.rotation };
                            const startOffsetDistance = 3.0;
                            const forwardVector = new THREE.Vector3(Math.sin(startParams.rotation),0,Math.cos(startParams.rotation));
                            const finalStartPosition = new THREE.Vector3(startParams.x + forwardVector.x * startOffsetDistance, 0.25, startParams.z + forwardVector.z * startOffsetDistance);
                            this.kart.position.copy(finalStartPosition);
                            const newBoundingBox = new THREE.Box3().setFromObject(this.kart);
                            this.kart.position.y -= newBoundingBox.min.y;
                            this.kart.rotation.y = startParams.rotation + Math.PI;
                            this.updateCamera();
                            this.camera.position.copy(this.cameraTargetPosition);
                            this.camera.lookAt(this.kart.position);

                            console.warn("Kart texture failed to load, using default material for Shaded/base.obj.");
                            resolve(); // Resolve even if texture fails, with model loaded
                        },
                        undefined,
                        (objError) => {
                             console.error('Fallback OBJ loading also failed:', objError);
                             // Last resort: create the old box kart
                            const kartGeometry = new THREE.BoxGeometry(1, 0.5, 2); // Adjusted to reflect previous kart size if desiredHeight was 1.0
                            const kartMaterial = new THREE.MeshBasicMaterial({ color: 0x800080 });
                            this.kart = new THREE.Mesh(kartGeometry, kartMaterial);
                            this.scene.add(this.kart);
                            
                            // Position fallback box kart
                            const newStartCheckpoint = this.checkpoints[0];
                            const startParams = { x: newStartCheckpoint.position.x, z: newStartCheckpoint.position.z, rotation: newStartCheckpoint.rotation };
                            const startOffsetDistance = 3.0;
                            const forwardVector = new THREE.Vector3(Math.sin(startParams.rotation),0,Math.cos(startParams.rotation));
                            const finalStartPosition = new THREE.Vector3(startParams.x + forwardVector.x * startOffsetDistance, 0.25, startParams.z + forwardVector.z * startOffsetDistance);
                            this.kart.position.copy(finalStartPosition);
                            this.kart.rotation.y = startParams.rotation + Math.PI;
                            
                            this.updateCamera();
                            this.camera.position.copy(this.cameraTargetPosition);
                            this.camera.lookAt(this.kart.position);

                            console.warn("Both texture and OBJ model loading failed. Fell back to default box kart.");
                            resolve(); // Resolve with box kart as last resort
                        }
                    );
                }
            );
        });
    }

    setupSparkParticles() {
        const positions = new Float32Array(this.maxSparks * 3);
        const colors = new Float32Array(this.maxSparks * 3);

        this.sparkGeometry = new THREE.BufferGeometry();
        this.sparkGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.sparkGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const sparkMaterial = new THREE.PointsMaterial({
            size: 0.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            depthWrite: false, // Prevent sparks hiding behind transparent objects
            blending: THREE.AdditiveBlending // Brighter where sparks overlap
        });

        this.sparkPoints = new THREE.Points(this.sparkGeometry, sparkMaterial);
        this.scene.add(this.sparkPoints);
    }

    // Modified to accept kartObject, kartSpeed, and a random function
    emitDriftSpark(color, kartObject = this.kart, kartSpeed = this.speed, randomFunction) {
        if (this.driftSparks.length >= this.maxSparks) return; // Don't exceed max

        // Calculate position behind rear wheels (adjust offsets as needed)
        const rearOffset = -1.2; // How far back from kart center
        const sideOffset = 0.4; // How far sideways from kart center
        const heightOffset = 0.1; // How high off the ground

        // Get the specific kart's orientation vectors
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(kartObject.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(kartObject.quaternion);

        // Always emit sparks on both sides instead of alternating
        const sides = [-1, 1]; // Left and right side
        
        for (const sideSign of sides) {
            // Skip if we've hit max sparks
            if (this.driftSparks.length >= this.maxSparks) break;
            
            const position = kartObject.position.clone() // Use kartObject's position
                .addScaledVector(forward, rearOffset)
                .addScaledVector(right, sideOffset * sideSign)
                .add(new THREE.Vector3(0, heightOffset, 0));

            // Calculate velocity (mostly backwards, slightly outwards and upwards) based on kartSpeed
            const baseVelocity = forward.clone().multiplyScalar(-kartSpeed * 5 - 2); // Use kartSpeed
            const outwardVelocity = right.clone().multiplyScalar(sideSign * (randomFunction() * 2 + 1)); // Sideways spread
            const upwardVelocity = new THREE.Vector3(0, randomFunction() * 2 + 1, 0); // Upward spread

            const velocity = baseVelocity.add(outwardVelocity).add(upwardVelocity);

            this.driftSparks.push({
                position: position,
                velocity: velocity,
                lifetime: this.sparkLifetime,
                color: color
            });
        }
    }

    updateDriftSparks(deltaTime) {
        const positions = this.sparkPoints.geometry.attributes.position.array;
        const colors = this.sparkPoints.geometry.attributes.color.array;
        let activeSparkCount = 0;

        for (let i = this.driftSparks.length - 1; i >= 0; i--) {
            const spark = this.driftSparks[i];
            spark.lifetime -= deltaTime;

            if (spark.lifetime <= 0) {
                this.driftSparks.splice(i, 1); // Remove dead spark
            } else {
                // Update position
                spark.position.addScaledVector(spark.velocity, deltaTime);
                // Apply simple gravity
                spark.velocity.y -= 9.8 * deltaTime; // Adjust gravity strength as needed

                // Update geometry attributes for active sparks
                const index = activeSparkCount * 3;
                positions[index] = spark.position.x;
                positions[index + 1] = spark.position.y;
                positions[index + 2] = spark.position.z;

                colors[index] = spark.color.r;
                colors[index + 1] = spark.color.g;
                colors[index + 2] = spark.color.b;

                activeSparkCount++;
            }
        }

        // Update draw range and tell Three.js the attributes have changed
        this.sparkPoints.geometry.setDrawRange(0, activeSparkCount);
        this.sparkPoints.geometry.attributes.position.needsUpdate = true;
        this.sparkPoints.geometry.attributes.color.needsUpdate = true;
    }


    startCountdown() {
        this.countdownDisplay.textContent = this.countdownValue;
        this.countdownDisplay.classList.remove('hidden');

        const countdownInterval = setInterval(() => {
            this.countdownValue--;
            if (this.countdownValue > 0) {
                this.countdownDisplay.textContent = this.countdownValue;
            } else if (this.countdownValue === 0) {
                this.countdownDisplay.textContent = 'GO!';
            } else {
                clearInterval(countdownInterval);
                this.countdownDisplay.classList.add('hidden');
                this.gameState = 'racing'; // Start the race
                this.animate(); // Start the main animation loop *after* countdown
            }
        }, 1000); // 1 second interval
    }

    createBots(numberOfBots) {
        if (!this.kart) {
            console.error("Player kart model not loaded. Cannot create bots with custom model.");
            // Optionally, implement a fallback to box bots here if desired
            return;
        }

        const botTintColors = [
            new THREE.Color(0xff6666), // Light Red
            new THREE.Color(0x66ff66), // Light Green
            new THREE.Color(0x66aaff), // Light Blue
            new THREE.Color(0xffff66), // Light Yellow
            new THREE.Color(0xff66ff), // Light Magenta
            new THREE.Color(0x66ffff)  // Light Cyan
        ];
        const startOffset = 5.0; // How far behind the line bots start
        const spacing = 2.5; // Spacing between bots, slightly increased for larger models

        // Use the starting parameters of the *new* first checkpoint (index 0)
        const newStartCheckpoint = this.checkpoints[0]; // Get the data for the new checkpoint 1
        const startParams = { x: newStartCheckpoint.position.x, z: newStartCheckpoint.position.z, rotation: newStartCheckpoint.rotation };
        // Calculate the forward vector *along* the starting rotation
        const forwardVector = new THREE.Vector3(
            Math.sin(startParams.rotation), 0, Math.cos(startParams.rotation)
        );
        // Calculate the side vector (perpendicular to forward)
        const sideVector = new THREE.Vector3(
            forwardVector.z, 0, -forwardVector.x
        );
        const startRotation = startParams.rotation + Math.PI; // Add 180 degrees rotation

        const baseSeed = Date.now(); // Get base seed again, or pass from constructor if needed consistency across restarts

        for (let i = 0; i < numberOfBots; i++) {
            // --- Create Bot PRNG ---
            const botSeed = baseSeed + i + 1;
            const botRandom = mulberry32(botSeed);
            this.botRandomGenerators[i] = botRandom;
            // --- End Bot PRNG ---
            
            const botMesh = this.kart.clone(true); // Deep clone the player's kart model
            const tintColor = botTintColors[i % botTintColors.length];

            botMesh.traverse((child) => {
                if (child.isMesh) {
                    // Clone the material to ensure each bot has its own instance
                    child.material = child.material.clone();
                    // Apply the tint. If playerKartTexture was null (texture load failed), this will color a basic material
                    child.material.color.set(tintColor);
                    if (this.playerKartTexture) {
                        child.material.map = this.playerKartTexture; // Ensure map is set if texture exists
                    }
                }
            });
            
            // Scale the bot model to match player kart's scale (derived from desiredHeight)
            botMesh.scale.copy(this.kart.scale); 

            // Calculate staggered starting position
            const botStartPositionBase = new THREE.Vector3(startParams.x, 0, startParams.z) // Start at y=0, will adjust
                .addScaledVector(forwardVector, startOffset + i * 1.5) 
                .addScaledVector(sideVector, (i % 2 === 0 ? 1 : -1) * spacing * Math.ceil((i+1)/2)); 
            
            botMesh.position.copy(botStartPositionBase);
            
            // Adjust Y position based on the cloned model's bounding box
            const botBoundingBox = new THREE.Box3().setFromObject(botMesh);
            botMesh.position.y -= botBoundingBox.min.y; // Align bottom of bot kart with track surface

            botMesh.rotation.y = startRotation;

            this.scene.add(botMesh);

            // Assign unique stats to each bot based on difficulty using bot's PRNG
            let botStats = {};
            const randomFactor1 = botRandom(); // Use bot's PRNG
            const randomFactor2 = botRandom(); // Use bot's PRNG
            const randomFactor3 = botRandom(); // Use bot's PRNG
            const randomFactor4 = botRandom(); // Use bot's PRNG
            // Bot base speeds are scaled by CC first, then difficulty applies to that scaled base
            const botBaseMaxSpeed = this.maxSpeed; // this.maxSpeed is already CC-adjusted
            const botBaseAcceleration = this.acceleration; // this.acceleration is already CC-adjusted

            switch (this.difficulty) {
                case 'medium':
                    botStats = {
                        maxSpeed: botBaseMaxSpeed * (0.80 + randomFactor1 * 0.2), // 80-100% of CC-adjusted speed
                        acceleration: botBaseAcceleration * (1.0 + randomFactor2 * 0.4), // 1.0x - 1.4x of CC-adjusted accel
                        turnRate: this.turnSpeed * (1.8 + randomFactor3 * 1.4), 
                        targetOffset: (randomFactor4 - 0.5) * 14 
                    };
                    break;
                case 'hard':
                    botStats = {
                        maxSpeed: botBaseMaxSpeed * (0.90 + randomFactor1 * 0.2), // 90-110%
                        acceleration: botBaseAcceleration * (1.1 + randomFactor2 * 0.4), // 1.1x - 1.5x
                        turnRate: this.turnSpeed * (2.2 + randomFactor3 * 1.6), 
                        targetOffset: (randomFactor4 - 0.5) * 10 
                    };
                    break;
                case 'easy':
                default: // Default to easy
                    botStats = {
                        maxSpeed: botBaseMaxSpeed * (0.65 + randomFactor1 * 0.2), // 65-85%
                        acceleration: botBaseAcceleration * (0.8 + randomFactor2 * 0.4),
                        turnRate: this.turnSpeed * (1.2 + randomFactor3 * 1.6), 
                        targetOffset: (randomFactor4 - 0.5) * 22 
                    };
                    break;
            }


            this.bots.push({
                mesh: botMesh,
                speed: 0, // Start stationary
                lap: 1, // Start on lap 1
                targetCheckpointIndex: 0, // Target the new checkpoint 1 (index 0)
                currentCheckpointIndex: 3, // Start at the new start/finish line (index 3)
                stats: botStats, // Store the unique stats
                random: botRandom, // Store the bot's specific PRNG function
                // Drift/Boost state for bots
                isDrifting: false,
                driftTime: 0,
                miniTurboStage: 0,
                boosting: false,
                boostTime: 0,
                // Dynamic path variation
                dynamicTargetOffset: 0, // Current dynamic offset value
                dynamicOffsetTimer: botRandom() * 0.5, // Timer to control how often dynamic offset changes (random start 0-0.5s) - USE PRNG
                dynamicOffsetUpdateTime: 0.2 + botRandom() * 0.4, // How often to change offset (0.2-0.6s) - More frequent updates - USE PRNG
                lastSparkEmitTime: 0, // Initialize spark timer for bots
                impulse: new THREE.Vector3(0, 0, 0), // Impulse vector for bumps
                impulseDecay: 0.85, // Same decay as player for consistency
                // Item state for bots
                item: null,
                stunDuration: 0,
                mushroomBoostDuration: 0,
                // Bot specific item effect states
                isInvisible: false,
                invisibilityDuration: 0,
                isAttemptingBooSteal: false, // For Boo steal attempt after invisibility
                shrinkDuration: 0,
                originalScale: new THREE.Vector3(1, 1, 1) // Store original scale for each bot
            });
        }
        // Store original scale for player kart
        this.kart.getWorldScale(this.originalPlayerScale);
        // Store original scale for bots
        this.bots.forEach(bot => bot.mesh.getWorldScale(bot.originalScale));
    }

    createRaceTrack() {
        // Create track shape
        const shape = new THREE.Shape();
        
        // Outer track edge
        const outerTrackPoints = [];
        const segments = 32;
        
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            const x = Math.cos(t) * this.trackLength / 2;
            const z = Math.sin(t) * this.trackWidth / 2;
            if (i === 0) {
                shape.moveTo(x, z);
            } else {
                shape.lineTo(x, z);
            }
        }

        // Inner track edge (hole)
        const holePath = new THREE.Path();
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            const x = Math.cos(t) * this.trackLengthInner / 2;
            const z = Math.sin(t) * this.trackWidthInner / 2;
            if (i === 0) {
                holePath.moveTo(x, z);
            } else {
                holePath.lineTo(x, z);
            }
        }
        shape.holes.push(holePath);

        // Create track mesh
        const geometry = new THREE.ShapeGeometry(shape);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x333333, 
            side: THREE.DoubleSide 
        });
        
        this.track = new THREE.Mesh(geometry, material);
        this.track.rotation.x = -Math.PI / 2;
        this.track.position.y = 0.1;
        this.scene.add(this.track);

        // Create checkpoints
        this.createCheckpoints();
        // Create the racing line path
        this.createRacingLine();
        // Create Walls
        this.createTrackWalls();
    }

    createWallSegmentMesh(p1, p2, height, thickness, material) {
        const diff = new THREE.Vector3().subVectors(p2, p1);
        const length = diff.length();
        // Calculate midpoint for positioning, base of wall is on track (y=0.1)
        const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
    
        const wallGeometry = new THREE.BoxGeometry(length, height, thickness);
        const wallMesh = new THREE.Mesh(wallGeometry, material);
    
        // Position the wall segment
        // The BoxGeometry's origin is its center. Walls sit on track surface (y=0.1).
        wallMesh.position.set(midPoint.x, 0.1 + height / 2, midPoint.z);
    
        // Orient the wall segment
        // The length of the BoxGeometry is along its local X-axis.
        // We want to rotate it in the XZ plane (around Y) to align with the segment from p1 to p2.
        // Then add an additional 90 degrees (PI/2) rotation.
        wallMesh.rotation.y = Math.atan2(diff.x, diff.z) + Math.PI / 2;
    
        return wallMesh;
    }

    createTrackWalls() {
        const segments = 32; // Same number of segments as track shape for smoothness

        // Outer Wall
        const outerWallPoints = [];
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            const x = Math.cos(t) * this.trackLength / 2;
            const z = Math.sin(t) * this.trackWidth / 2;
            outerWallPoints.push(new THREE.Vector3(x, 0, z)); // Y is 0 relative to wall base
        }
        for (let i = 0; i < segments; i++) {
            const p1 = outerWallPoints[i];
            const p2 = outerWallPoints[i+1];
            const wallSegment = this.createWallSegmentMesh(p1, p2, this.WALL_HEIGHT, this.WALL_THICKNESS, this.WALL_MATERIAL);
            this.scene.add(wallSegment);
            this.wallMeshes.push(wallSegment);
        }

        // Inner Wall
        const innerWallPoints = [];
        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * Math.PI * 2;
            const x = Math.cos(t) * this.trackLengthInner / 2;
            const z = Math.sin(t) * this.trackWidthInner / 2;
            innerWallPoints.push(new THREE.Vector3(x, 0, z));
        }
        for (let i = 0; i < segments; i++) {
            const p1 = innerWallPoints[i];
            const p2 = innerWallPoints[i+1];
            const wallSegment = this.createWallSegmentMesh(p1, p2, this.WALL_HEIGHT, this.WALL_THICKNESS, this.WALL_MATERIAL);
            this.scene.add(wallSegment);
            this.wallMeshes.push(wallSegment);
        }
    }


    // New function to calculate points along the track centerline
    createRacingLine(numPoints = 100) {
        const avgLength = (this.trackLength + this.trackLengthInner) / 2;
        const avgWidth = (this.trackWidth + this.trackWidthInner) / 2;

        for (let i = 0; i < numPoints; i++) {
            const t = (i / numPoints) * Math.PI * 2;
            const x = Math.cos(t) * avgLength / 2;
            const z = Math.sin(t) * avgWidth / 2;
            this.racingLinePoints.push(new THREE.Vector3(x, 0.1, z)); // Store points at track height
        }
        // Optional: Visualize the path for debugging
        // const lineMat = new THREE.LineBasicMaterial({ color: 0xff00ff });
        // const lineGeo = new THREE.BufferGeometry().setFromPoints(this.racingLinePoints);
        // const pathLine = new THREE.LineLoop(lineGeo, lineMat); // Use LineLoop for closed path
        // this.scene.add(pathLine);
    }


    createCheckpoints() {
        // Create visible checkpoints with clearer appearance
        const checkpointMaterial = new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });

        // Calculate the drivable width (distance between outer and inner track edges)
        const checkpointWidth = 45; // Adjusted to be wider but not the full track width for better gameplay
        const postHeight = 8; // Made posts taller for better visibility

        // Create checkpoint positions (4 points around the track) - REORDERED
        const checkpointPositions = [
            // Original 4 is now 1
            { x: -this.trackLength / 3, z: 0, rotation: 0, color: 0xffff00, number: "1" }, // New Checkpoint 1 (yellow)
            // Original 3 is now 2
            { x: 0, z: -this.trackWidth / 4, rotation: -Math.PI/2, color: 0x0000ff, number: "2" }, // New Checkpoint 2 (blue)
            // Original 2 is now 3
            { x: this.trackLength / 3, z: 0, rotation: Math.PI, color: 0x00ff00, number: "3" }, // New Checkpoint 3 (green)
            // Original 1 is now 4 (Start/Finish)
            { x: 0, z: this.trackWidth /4, rotation: Math.PI/2, color: 0xff0000, number: "4" }, // New Start/Finish line (red)
        ];

        checkpointPositions.forEach((pos, index) => {
            // Create vertical post markers with increased height
            const postGeometry = new THREE.BoxGeometry(2, postHeight, 2);
            const postMaterial = new THREE.MeshBasicMaterial({ color: pos.color });
            
            // Position posts wider apart
            const postOffset = checkpointWidth / 2;
            
            // Left post
            const leftPost = new THREE.Mesh(postGeometry, postMaterial);
            leftPost.position.set(
                pos.x - Math.sin(pos.rotation) * postOffset,
                postHeight/2,
                pos.z - Math.cos(pos.rotation) * postOffset
            );
            this.scene.add(leftPost);
            
            // Right post
            const rightPost = new THREE.Mesh(postGeometry, postMaterial);
            rightPost.position.set(
                pos.x + Math.sin(pos.rotation) * postOffset,
                postHeight/2,
                pos.z + Math.cos(pos.rotation) * postOffset
            );
            this.scene.add(rightPost);

            // Create checkpoint gate with increased width and height
            const checkpointGeometry = new THREE.PlaneGeometry(checkpointWidth, postHeight);
            const checkpoint = new THREE.Mesh(checkpointGeometry, new THREE.MeshBasicMaterial({
                color: pos.color,
                transparent: true,
                opacity: 0.3,
                side: THREE.DoubleSide
            }));
            checkpoint.position.set(pos.x, postHeight/2, pos.z);
            checkpoint.rotation.y = pos.rotation;
            this.scene.add(checkpoint);

            // Add checkpoint number
            const canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            const context = canvas.getContext('2d');
            context.fillStyle = '#ffffff';
            context.font = 'bold 80px Arial';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(pos.number, 64, 64);

            const numberTexture = new THREE.CanvasTexture(canvas);
            const numberMaterial = new THREE.SpriteMaterial({ map: numberTexture });
            const numberSprite = new THREE.Sprite(numberMaterial);
            numberSprite.scale.set(4, 4, 1); // Increased number size
            numberSprite.position.set(pos.x, postHeight + 1, pos.z); // Position above the checkpoint

            this.scene.add(numberSprite);
            
            // Store checkpoint data
            this.checkpoints[index] = {
                position: new THREE.Vector3(pos.x, 0.15, pos.z),
                rotation: pos.rotation,
                mesh: checkpoint,
                // Calculate and store the correct normal vector for the checkpoint plane
                // Normal points in the direction of travel through the gate: (sin(rot), 0, cos(rot))
                normal: new THREE.Vector3(Math.sin(pos.rotation), 0, Math.cos(pos.rotation)),
                posts: [leftPost, rightPost],
                numberSprite: numberSprite
            };
        });
    }

    createItemBoxes() {
        const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
        // Simple rainbow texture for item boxes
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, 'red');
        gradient.addColorStop(1/6, 'orange');
        gradient.addColorStop(2/6, 'yellow');
        gradient.addColorStop(3/6, 'green');
        gradient.addColorStop(4/6, 'blue');
        gradient.addColorStop(5/6, 'indigo');
        gradient.addColorStop(1, 'violet');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);

        const boxMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.8 });

        // Define item box positions (adjust these based on your track)
        const boxPositions = [
            { x: this.trackLength * 0.3, z: this.trackWidth * 0.1 },
            { x: this.trackLength * 0.3, z: -this.trackWidth * 0.1 },
            { x: -this.trackLength * 0.3, z: this.trackWidth * 0.1 },
            { x: -this.trackLength * 0.3, z: -this.trackWidth * 0.1 },
            { x: 0, z: this.trackWidth * 0.3 },
            { x: 0, z: -this.trackWidth * 0.3 },
        ];

        boxPositions.forEach(pos => {
            const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
            boxMesh.position.set(pos.x, 1.0, pos.z); // Position slightly above track
            this.scene.add(boxMesh);
            this.itemBoxMeshes.push(boxMesh);

            this.itemBoxes.push({
                mesh: boxMesh,
                position: boxMesh.position.clone(),
                isActive: true,
                respawnTimer: 0,
                radius: 1.5 // Collision radius
            });
        });
    }

    setupControls() {
        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            const wasPressed = this.keys[e.key.toLowerCase()];
            this.keys[e.key.toLowerCase()] = true;
            if (e.key === ' ' && !wasPressed) {
                this.touchControls.drift = true;
                this.handleDriftPress();
            }
            // Use item with 'e' key
            if (e.key.toLowerCase() === 'e' && !wasPressed) {
                 this.useItem({ mesh: this.kart, item: this.playerItem, stunDuration: this.playerStunDuration, mushroomBoostDuration: this.playerMushroomBoostDuration }); // Pass player object wrapper
            }
            // Rear view toggle with 'c' key
            if (e.key.toLowerCase() === 'c' && !wasPressed) {
                // this.toggleRearView(); // Replaced with direct state change
                this.isRearViewActive = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
            if (e.key === ' ') {
                this.touchControls.drift = false;
            }
            // Set rear view to false on key up for 'c'
            if (e.key.toLowerCase() === 'c') {
                this.isRearViewActive = false;
            }
        });
        
        // Touch controls with improved handling
        const addTouchListener = (id, control) => {
            const element = document.getElementById(id);
            if (!element) return;

            const startTouch = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.touchControls[control] = true;
                if (control === 'drift') {
                    this.handleDriftPress();
                }
                element.style.background = 'rgba(255, 255, 255, 0.6)';
            };

            const endTouch = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.touchControls[control] = false;
                element.style.background = 'rgba(255, 255, 255, 0.4)';
            };

            // Touch events
            element.addEventListener('touchstart', startTouch, { passive: false });
            element.addEventListener('touchend', endTouch, { passive: false });
            element.addEventListener('touchcancel', endTouch, { passive: false });

            // Mouse events for testing
            element.addEventListener('mousedown', startTouch);
            element.addEventListener('mouseup', endTouch);
            element.addEventListener('mouseleave', endTouch);
        };

        addTouchListener('forward-button', 'forward');
        addTouchListener('backward-button', 'backward');
        addTouchListener('left-button', 'left');
        addTouchListener('right-button', 'right');
        addTouchListener('drift-button', 'drift');
        // addTouchListener('use-item-button', 'useItem'); 
        // Use item already has special handling.

        // Touch listener for rear view button is now handled explicitly below, not via addTouchListener
        // addTouchListener('rear-view-button', 'rearView'); 


        // Special handling for useItem touch control to call the function directly
        const useItemElement = document.getElementById('use-item-button');
        if (useItemElement) {
            useItemElement.addEventListener('touchstart', (e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 this.useItem({ mesh: this.kart, item: this.playerItem, stunDuration: this.playerStunDuration, mushroomBoostDuration: this.playerMushroomBoostDuration });
                 useItemElement.style.background = 'rgba(100, 100, 255, 0.8)'; // Darker feedback
            }, { passive: false });
             useItemElement.addEventListener('touchend', (e) => {
                 e.preventDefault();
                 e.stopPropagation();
                 useItemElement.style.background = 'rgba(100, 100, 255, 0.5)'; // Restore background
            }, { passive: false });
        }
        
        // Special handling for rearView touch control (hold)
        const rearViewElement = document.getElementById('rear-view-button');
        if (rearViewElement) {
            const rearViewStart = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isRearViewActive = true;
                rearViewElement.style.background = 'rgba(150, 150, 150, 0.8)'; // Darker feedback
            };
            const rearViewEnd = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isRearViewActive = false;
                rearViewElement.style.background = 'rgba(150, 150, 150, 0.5)'; // Restore background
            };

            // Touch events
            rearViewElement.addEventListener('touchstart', rearViewStart, { passive: false });
            rearViewElement.addEventListener('touchend', rearViewEnd, { passive: false });
            rearViewElement.addEventListener('touchcancel', rearViewEnd, { passive: false }); // Handle cancel

            // Mouse events for testing
            rearViewElement.addEventListener('mousedown', rearViewStart);
            rearViewElement.addEventListener('mouseup', rearViewEnd);
            rearViewElement.addEventListener('mouseleave', rearViewEnd); // Handle mouse leaving button area
        }


        // Resize handler
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    handleDriftPress() {
        if (!this.isDrifting && this.speed > 0 && !this.isHopping) {
            this.isHopping = true;
            this.verticalVelocity = this.hopSpeed;
            this.canStartDrift = true;
            this.driftDirection = 0; // Reset drift direction
            this.driftTime = 0; // Reset drift time
            this.miniTurboStage = 0; // Reset mini-turbo stage
        }
    }

    // toggleRearView() { // Method no longer needed as it's hold-based
    //     this.isRearViewActive = !this.isRearViewActive;
    //     // console.log("Rear view toggled:", this.isRearViewActive);
    // }

    updateSpeedometer() {
        // Convert speed to km/h using the universal conversion factor derived from 150cc.
        const speedKmh = Math.abs(this.speed) * this.universalKmhConversionFactor;
        this.speedDisplay.textContent = Math.round(speedKmh);
    }

    updateCamera() {
        if (!this.kart) return; // Ensure kart exists

        let cameraOffset;
        let lookAtTarget = this.kart.position.clone();

        if (this.isRearViewActive) {
            // Rear view: Camera in front, looking back at the kart
            const frontOffsetDistance = 8; // How far in front of the kart
            cameraOffset = new THREE.Vector3(0, this.cameraHeight, frontOffsetDistance); // Positive Z for in front
            // Apply kart's rotation to this offset
            cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.kart.rotation.y);
            this.cameraTargetPosition.copy(this.kart.position).add(cameraOffset);
            // Look directly at the kart's center for rear view
            lookAtTarget = this.kart.position.clone();
        } else {
            // Normal view: Camera behind, looking forward
            cameraOffset = new THREE.Vector3(0, this.cameraHeight, this.cameraDistance); // cameraDistance is negative
            cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.kart.rotation.y);
            this.cameraTargetPosition.copy(this.kart.position).add(cameraOffset);

            // Calculate look-at position with slight prediction based on movement for normal view
            const kartVelocity = new THREE.Vector3().copy(this.kart.position).sub(this.lastKartPosition);
            lookAtTarget = new THREE.Vector3().copy(this.kart.position).add(kartVelocity.multiplyScalar(2));
        }

        // Smooth camera position using lerp
        this.camera.position.lerp(this.cameraTargetPosition, this.cameraLerpFactor);
        // Always look at the determined target
        this.camera.lookAt(lookAtTarget);
    }

    updateKart(deltaTime) { // Accept deltaTime as an argument
        // Only allow updates if the race is active
        if (this.gameState !== 'racing') {
            // Still update camera and render, but don't move kart
            this.updateCamera();
            this.updateSpeedometer(); // Keep speedometer at 0
            return;
        }

        // --- Handle Player Effects (Boo, Lightning, Stun) ---
        if (this.playerIsInvisible) { // Handles Boo invisibility primarily
            this.playerInvisibilityDuration -= deltaTime;

            if (this.playerInvisibilityDuration <= 0) {
                // Invisibility duration from Boo has ended.
                if (this.playerIsAttemptingBooSteal) {
                    const itemStolenSuccessfully = this.stealItemWithBoo(this.kart); // 'this.kart' is the racer object for player

                    if (itemStolenSuccessfully) {
                        // stealItemWithBoo already put the item in this.playerItem (stolen item)
                        console.log(`Boo stole ${this.playerItem} for Player!`);
                        this.playerInvisibilityDuration = 0; // End invisibility due to successful steal
                    } else {
                        // Steal from another racer failed. stealItemWithBoo has given the player a 'mushroom'.
                        // this.playerItem is already 'mushroom'. Invisibility continues for its normal duration.
                        // The console log for receiving a mushroom is in stealItemWithBoo.
                        console.log("Player's Boo failed to steal from another; player received a mushroom. Invisibility continues.");
                    }
                    this.playerIsAttemptingBooSteal = false;
                    this.updateItemDisplay(); // Update display with new item or empty
                }

                // Restore visibility unless another effect keeps player invisible
                // For now, assume Boo was the only source of this invisibility state
                this.playerIsInvisible = false;
                this.kart.traverse(child => {
                    if (child.isMesh) {
                        child.material.opacity = 1.0;
                        // Consider if material was originally transparent:
                        // child.material.transparent = child.material.userData.wasTransparent || false;
                    }
                });
            }
        }
        if (this.playerShrinkDuration > 0) {
            this.playerShrinkDuration -= deltaTime;
            if (this.playerShrinkDuration <= 0) {
                this.kart.scale.copy(this.originalPlayerScale); // Restore scale
            }
        }
        if (this.playerStunDuration > 0) {
            this.playerStunDuration -= deltaTime;
            this.updateCamera(); 
            this.updateSpeedometer();
            // Kart can still be controlled slightly or just shows stun effect
            // For now, full stop of input processing is below, this just ticks down stun
            if (this.playerStunDuration <=0) { /* stun just ended */ }
            // If stunned, we might want to prevent most actions below.
            // For now, the main movement restriction comes from speed being set to 0 or low.
        }
        // If stunned, significantly reduce ability to control or move
        const isPlayerActuallyStunned = this.playerStunDuration > 0;


        // Store previous position *before* calculating new position for this frame
        this.lastKartPosition.copy(this.kart.position);

        // If stunned, skip most input and movement logic
        if (isPlayerActuallyStunned) {
            // Apply strong deceleration if stunned
            this.speed = Math.abs(this.speed) < this.deceleration * 2 ? 0 :
                         this.speed - Math.sign(this.speed) * this.deceleration * 2;
            const movement = new THREE.Vector3(
                Math.sin(this.kart.rotation.y) * this.speed,
                0,
                Math.cos(this.kart.rotation.y) * this.speed
            );
            this.kart.position.add(movement);
            this.kart.position.y = 0.25 + this.hopHeight; // Keep hop physics if mid-hop during stun
            this.updateCamera();
            this.updateSpeedometer();
            return; // Skip normal controls and movement updates
        }

        // Store previous position *before* calculating new position for this frame
        this.lastKartPosition.copy(this.kart.position);
        // Check if trying to drift
        const wantsDoDrift = this.keys[' '] || this.touchControls.drift;
        const turningLeft = this.keys['a'] || this.keys['arrowleft'] || this.touchControls.left;
        const turningRight = this.keys['d'] || this.keys['arrowright'] || this.touchControls.right;
        const isTurning = turningLeft || turningRight;

        // Store drift direction only when initiating a new drift
        if (this.isDrifting && this.driftActive && this.driftDirection === 0 && isTurning) {
            if (turningLeft) {
                this.driftDirection = 1;
            } else if (turningRight) {
                this.driftDirection = -1;
            }
            this.isInDriftMomentum = false;
        }

        // Update mini-turbo
        if (this.isDrifting && this.driftActive) {
            const turningLeft = this.keys['a'] || this.keys['arrowleft'] || this.touchControls.left;
            const turningRight = this.keys['d'] || this.keys['arrowright'] || this.touchControls.right;
            const isTurning = turningLeft || turningRight;

            // Determine charge rate based on drift state and input
            let chargeRate = 1.0; // Default full charge rate
            
            // Check if turning in opposite direction of drift
            const isOppositeDirection = (this.driftDirection > 0 && turningRight) || 
                                      (this.driftDirection < 0 && turningLeft);
            
            if (isOppositeDirection) {
                chargeRate = 0.25; // Very slow charge when turning opposite
            } else if (!isTurning) {
                chargeRate = 0.3; // .3 speed when not turning
            }

            // Apply charge rate to drift time
            const deltaTime = 1 / 60; // Assuming 60fps, replace with actual delta time if available
            this.driftTime += deltaTime * chargeRate;

            // Update mini-turbo stage based on drift time
            for (let i = this.miniTurboThresholds.length - 1; i >= 0; i--) {
                if (this.driftTime >= this.miniTurboThresholds[i]) {
                    this.miniTurboStage = i;
                    break;
                }
            }

            // Emit sparks based on mini-turbo stage
            if (this.miniTurboStage > 0) {
                const now = performance.now() / 1000; // Time in seconds
                const timeSinceLastEmit = now - this.lastSparkEmitTime;
                const emitInterval = 1 / this.sparkEmitRate;

                if (timeSinceLastEmit >= emitInterval) {
                    const sparkColor = this.sparkColors[this.miniTurboStage - 1];
                    this.emitDriftSpark(sparkColor, this.kart, this.speed, this.playerRandom);
                    this.lastSparkEmitTime = now;
                }
            }
        } else {
            // If we stop drifting, check if we should apply boost
            if (this.driftTime > this.miniTurboThresholds[1]) {
                this.boosting = true;
                this.boostTime = this.miniTurboBoostDurations[this.miniTurboStage - 1];
                this.maxBoostTime = this.miniTurboBoostDurations[this.miniTurboStage - 1];
                this.boostMultiplier = 1.3; // Fixed boost multiplier
            }
            this.driftTime = 0;
            this.miniTurboStage = 0;
            // No need to hide HTML element anymore
        }

        // Update boost
        if (this.boosting) {
            this.boostTime -= 1/60;
            if (this.boostTime <= 0) {
                this.boosting = false;
                this.boostMultiplier = 1;
            }
        }

        // Update hop animation
        if (this.isHopping) {
            this.hopHeight += this.verticalVelocity;
            this.verticalVelocity -= this.gravity;

            // Allow drift to start during the hop if turning
            if (this.canStartDrift && isTurning && wantsDoDrift) {
                this.isDrifting = true;
                this.driftActive = false; // Don't apply drift effects yet
            }

            // Land from hop
            if (this.hopHeight <= 0) {
                this.hopHeight = 0;
                this.isHopping = false;
                this.verticalVelocity = 0;
                this.canStartDrift = false;
                if (this.isDrifting && isTurning && wantsDoDrift) {
                    this.driftActive = true; // Start applying drift effects
                } else {
                    this.isDrifting = false;
                }
            }
        }

        // Handle drift momentum and turning
        if (this.speed !== 0) {
            let currentTurnSpeed = this.driftActive ? this.turnSpeed * this.driftTurnMultiplier : this.turnSpeed;
            
            if (this.isDrifting && this.driftActive) {
                // Check if turning in opposite direction of drift
                const isOppositeDirection = (this.driftDirection > 0 && turningRight) || 
                                          (this.driftDirection < 0 && turningLeft);
                
                if (isOppositeDirection) {
                    // Set drift momentum to a lower value instead of 0
                    this.driftMomentumTurnSpeed = Math.max(
                        this.defaultDriftMomentumTurnSpeed * 0.2, // Reduce to 20% of default momentum
                        0.002 // Minimum momentum to prevent complete stop
                    );
                } else if (isTurning) {
                    // Normal drift turning in same direction, restore default momentum
                    this.driftMomentumTurnSpeed = this.defaultDriftMomentumTurnSpeed;
                    this.isInDriftMomentum = false;
                    
                    if (turningLeft) {
                        this.kart.rotation.y += currentTurnSpeed;
                    }
                    if (turningRight) {
                        this.kart.rotation.y -= currentTurnSpeed;
                    }
                } else {
                    // No direction pressed during drift - apply momentum
                    this.isInDriftMomentum = true;
                    this.kart.rotation.y += this.driftDirection * this.driftMomentumTurnSpeed;
                }
            } else {
                // Normal non-drift turning
                this.isInDriftMomentum = false;
                if (turningLeft) {
                    this.kart.rotation.y += currentTurnSpeed;
                }
                if (turningRight) {
                    this.kart.rotation.y -= currentTurnSpeed;
                }
            }
        }

        // Reset momentum speed when drift ends
        if (!this.isDrifting) {
            this.driftMomentumTurnSpeed = this.defaultDriftMomentumTurnSpeed;
        }

        // End drift only if drift button is released or speed is zero
        if (!wantsDoDrift || this.speed === 0) {
            this.isDrifting = false;
            this.driftActive = false;
            this.canStartDrift = false;
            this.isInDriftMomentum = false;
        }

        // Calculate target speed limit
        this.targetSpeedLimit = this.maxSpeed;
        if (this.driftActive) {
            this.targetSpeedLimit *= this.driftSpeedMultiplier;
        }
        // Apply Mushroom boost (potentially overrides mini-turbo boost multiplier)
        let currentBoostMultiplier = 1.0;
        if (this.playerMushroomBoostDuration > 0) {
            this.playerMushroomBoostDuration -= deltaTime; // Use deltaTime
            currentBoostMultiplier = this.mushroomBoostMultiplier;
        } else if (this.boosting) { // Apply mini-turbo boost only if mushroom isn't active
             currentBoostMultiplier = this.boostMultiplier;
        }
        this.targetSpeedLimit *= currentBoostMultiplier;


        // Apply off-road penalty
        if (this.isOffRoad(this.kart.position)) {
            this.targetSpeedLimit *= this.offRoadMultiplier;
        }
        // Apply shrink penalty from lightning
        if (this.playerShrinkDuration > 0) {
            this.targetSpeedLimit *= 0.6; // Reduced speed while shrunk
        }

        // Smoothly interpolate current speed limit
        this.currentSpeedLimit = this.currentSpeedLimit + (this.targetSpeedLimit - this.currentSpeedLimit) * this.speedLimitLerpFactor;

        // Forward/Backward movement
        if (this.keys['w'] || this.keys['arrowup'] || this.touchControls.forward) {
            this.speed = Math.min(this.speed + this.acceleration, this.currentSpeedLimit);
        } else if (this.keys['s'] || this.keys['arrowdown'] || this.touchControls.backward) {
            this.speed = Math.max(this.speed - this.acceleration, -this.currentSpeedLimit / 2);
        } else {
            this.speed = Math.abs(this.speed) < this.deceleration ? 0 :
                        this.speed - Math.sign(this.speed) * this.deceleration;
        }

        // If current speed is above the limit, gradually decrease it
        if (Math.abs(this.speed) > this.currentSpeedLimit) {
            const targetSpeed = Math.sign(this.speed) * this.currentSpeedLimit;
            this.speed = this.speed + (targetSpeed - this.speed) * this.speedLimitLerpFactor;
        }

        // Update position
        const movement = new THREE.Vector3(
            Math.sin(this.kart.rotation.y) * this.speed,
            0,
            Math.cos(this.kart.rotation.y) * this.speed
        );

        // Handle wall collisions before adding main movement
        const collidedWithWall = this.handleWallCollisions(
            { mesh: this.kart, speedRef: { get: () => this.speed, set: (val) => this.speed = val }, rotationYRef: { get: () => this.kart.rotation.y, set: (val) => this.kart.rotation.y = val }, impulse: this.impulse, isPlayer: true },
            movement,
            this.kartRadius
        );

        if (!collidedWithWall) {
            this.kart.position.add(movement);
        }

        // Apply bump impulse (still applies even if wall-collided, can be adjusted)
        this.kart.position.add(this.impulse);
        // Decay impulse
        this.impulse.multiplyScalar(this.impulseDecay);
        if (this.impulse.lengthSq() < 0.0001) {
            this.impulse.set(0, 0, 0); // Reset if very small
        }

        // Update kart height based on hop
        this.kart.position.y = 0.25 + this.hopHeight;

        // Update camera separately
        this.updateCamera();

        // Update speedometer
        this.updateSpeedometer();
    }

    isOffRoad(position) {
        const x = position.x;
        const z = position.z;
        const outerA = this.trackLength / 2;
        const outerB = this.trackWidth / 2;
        const innerA = this.trackLengthInner / 2;
        const innerB = this.trackWidthInner / 2;

        // Check if outside the outer ellipse
        const isOutsideOuter = (x / outerA) ** 2 + (z / outerB) ** 2 > 1;

        // Check if inside the inner ellipse (hole)
        const isInsideInner = (x / innerA) ** 2 + (z / innerB) ** 2 < 1;

        return isOutsideOuter || isInsideInner;
    }

    updateLapCounter() {
        this.lapDisplay.innerHTML = `<div class="lap-count">LAP ${this.currentLap}/${this.maxLaps}</div>`;
        
        // Animate the display when lap changes
        if (this.currentLap > 1) {
            this.lapDisplay.classList.add('lap-changed');
            setTimeout(() => {
                this.lapDisplay.classList.remove('lap-changed');
            }, 1000);
        }
    }

    checkCheckpoints() {
        if (this.raceFinished) return;

        // Calculate which checkpoint the kart is near
        for (let i = 0; i < this.checkpoints.length; i++) {
            const checkpoint = this.checkpoints[i];
            
            // Calculate checkpoint line endpoints using post positions
            const leftPost = checkpoint.posts[0].position;
            const rightPost = checkpoint.posts[1].position;
            
            // Log the distance from the kart to the checkpoint center
            const checkpointCenter = new THREE.Vector3(
                (leftPost.x + rightPost.x) / 2,
                (leftPost.y + rightPost.y) / 2,
                (leftPost.z + rightPost.z) / 2
            );
            const checkpointNormal = checkpoint.normal;
            const checkpointWidth = leftPost.distanceTo(rightPost); // Use distance between posts as width

            // Vectors from checkpoint center to previous and current kart positions (using only XZ plane)
            const vecToPrevKart = new THREE.Vector3(
                this.lastKartPosition.x - checkpointCenter.x,
                0,
                this.lastKartPosition.z - checkpointCenter.z
            );
            const vecToCurrKart = new THREE.Vector3(
                this.kart.position.x - checkpointCenter.x,
                0,
                this.kart.position.z - checkpointCenter.z
            );

            // Project these vectors onto the checkpoint normal
            const prevDot = vecToPrevKart.dot(checkpointNormal);
            const currDot = vecToCurrKart.dot(checkpointNormal);

            // Check if the kart crossed the plane (sign change, ignoring crossing exactly on the plane)
            if (Math.sign(prevDot) !== Math.sign(currDot) && prevDot !== 0 && currDot !== 0) {

                // Calculate the intersection point on the plane (using linear interpolation on XZ)
                const t = prevDot / (prevDot - currDot); // Interpolation factor
                const intersectionPoint = new THREE.Vector3().lerpVectors(this.lastKartPosition, this.kart.position, t);

                // Vector from checkpoint center to intersection point
                const vecCenterToIntersection = new THREE.Vector3().subVectors(intersectionPoint, checkpointCenter);

                // Calculate the vector representing the gate line (perpendicular to the normal)
                const checkpointDirection = new THREE.Vector3(checkpointNormal.z, 0, -checkpointNormal.x).normalize();

                // Project the intersection vector onto the gate line vector
                const distanceAlongGate = vecCenterToIntersection.dot(checkpointDirection);

                // Check if the intersection happened within the gate width
                if (Math.abs(distanceAlongGate) < checkpointWidth / 2) {
                    // Check if this is the next expected checkpoint
                    if (i === (this.lastCheckpoint + 1) % this.totalCheckpoints) {
                        // Check for lap completion *before* updating lastCheckpoint
                        // Condition: Crossing the finish line (i=3) and the previous checkpoint was 2
                        const completingLap = (i === 3 && this.lastCheckpoint === 2);

                        // Now update lastCheckpoint
                        this.lastCheckpoint = i;
                        // console.log(`%cValid checkpoint sequence! Checkpoint ${i + 1} registered`, 'background: #2196F3; color: white; padding: 4px; border-radius: 4px;'); // DEBUG REMOVED

                        if (completingLap) {
                            this.currentLap++;
                            this.checkpointsPassed = 0; // Reset checkpoints passed for the new lap
                            // console.log(`%cLap ${this.currentLap} started!`, 'background: #9C27B0; color: white; padding: 4px; border-radius: 4px;'); // DEBUG REMOVED
                            this.updateLapCounter();

                            // Check if race is finished
                        if (this.currentLap > this.maxLaps) {
                            this.raceFinished = true;
                            console.log('%cRace Complete!', 'background: #FFC107; color: black; padding: 4px; border-radius: 4px;');
                            
                            // Create and show custom race completion modal
                            const finalPosition = this.getOrdinalSuffix(this.playerPosition);
                            const modal = document.createElement('div');
                            modal.style.position = 'fixed';
                            modal.style.top = '50%';
                            modal.style.left = '50%';
                            modal.style.transform = 'translate(-50%, -50%)';
                            modal.style.background = 'rgba(0, 0, 0, 0.85)';
                            modal.style.padding = '20px';
                            modal.style.borderRadius = '10px';
                            modal.style.color = 'white';
                            modal.style.textAlign = 'center';
                            modal.style.zIndex = '1000';
                            modal.style.minWidth = '250px';
                            
                            const header = document.createElement('h2');
                            header.innerText = 'Race Complete!';
                            header.style.color = '#FFC107';
                            header.style.marginBottom = '15px';
                            
                            const result = document.createElement('p');
                            result.innerText = `You finished in ${finalPosition} place!`;
                            result.style.fontSize = '1.2em';
                            result.style.marginBottom = '20px';
                            
                            const retryButton = document.createElement('button');
                            retryButton.innerText = 'Race Again';
                            retryButton.style.padding = '10px 20px';
                            retryButton.style.background = '#4CAF50';
                            retryButton.style.color = 'white';
                            retryButton.style.border = 'none';
                            retryButton.style.borderRadius = '5px';
                            retryButton.style.cursor = 'pointer';
                            retryButton.style.fontSize = '1.1em';
                            retryButton.onclick = () => {
                                // Reload the page to restart the game
                                window.location.reload();
                            };
                            
                            modal.appendChild(header);
                            modal.appendChild(result);
                            modal.appendChild(retryButton);
                            document.body.appendChild(modal);
                        }
                    }

                    // Increment checkpoints passed *unless* a lap was just completed (it resets to 0)
                    if (!completingLap) {
                        this.checkpointsPassed++;
                    }
                    // console.debug(`Checkpoints passed this lap: ${this.checkpointsPassed}/${this.totalCheckpoints}`); // DEBUG REMOVED

                } else {
                    console.warn(`Wrong checkpoint sequence! Expected ${(this.lastCheckpoint + 1) % this.totalCheckpoints + 1}, got ${i + 1}`);
                }
                break;
            }
        }
    }
    }

    // Helper to get ordinal suffix (1st, 2nd, 3rd, 4th)
    getOrdinalSuffix(n) {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // Helper to calculate distance to the center of the next checkpoint
    calculateDistanceToNextCheckpoint(currentPosition, nextCheckpointIndex) {
        // const logDistance = this.frameCount % 60 === 0; // Check if we should log this frame
        // if (logDistance) console.log(`%cCalculating distance (Frame ${this.frameCount}) for pos: (${currentPosition.x.toFixed(2)}, ${currentPosition.z.toFixed(2)}) to checkpoint index: ${nextCheckpointIndex}`, 'color: cyan');
        if (!this.checkpoints || this.checkpoints.length === 0) {
            // if (logDistance) console.log("  -> No checkpoints defined, returning Infinity");
            return Infinity;
        }
        const targetCheckpoint = this.checkpoints[nextCheckpointIndex];
        if (!targetCheckpoint) {
            // if (logDistance) console.log(`  -> Checkpoint index ${nextCheckpointIndex} not found, returning Infinity`);
            return Infinity;
        }
        // Use XZ distance for ranking to ignore hop height
        const dx = currentPosition.x - targetCheckpoint.position.x;
        const dz = currentPosition.z - targetCheckpoint.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        // if (logDistance) console.log(`  -> Target Checkpoint ${nextCheckpointIndex + 1} Pos: (${targetCheckpoint.position.x.toFixed(2)}, ${targetCheckpoint.position.z.toFixed(2)}), dx: ${dx.toFixed(2)}, dz: ${dz.toFixed(2)}, Distance: ${distance.toFixed(2)}`);
        return distance;
    }

    // --- Item Box and Banana Updates ---

    updateItemBoxes(deltaTime) {
        this.itemBoxes.forEach(box => {
            if (!box.isActive) {
                box.respawnTimer -= deltaTime;
                if (box.respawnTimer <= 0) {
                    box.isActive = true;
                    box.mesh.visible = true;
                }
            } else {
                 // Optional: Add visual effect like rotation
                 box.mesh.rotation.y += 0.02;
            }
        });
    }

    checkItemBoxCollisions() {
        const playerPos = this.kart.position;
        this.itemBoxes.forEach(box => {
            if (box.isActive && playerPos.distanceTo(box.position) < box.radius + 0.5) { // 0.5 is kart radius approx
                this.giveItem({ mesh: this.kart }); // Pass player identifier
                box.isActive = false;
                box.mesh.visible = false;
                box.respawnTimer = this.itemBoxRespawnTime;
            }
            // Check for bots
            this.bots.forEach(bot => {
                 if (box.isActive && bot.mesh.position.distanceTo(box.position) < box.radius + 0.5) {
                     this.giveItem(bot); // Pass bot object
                     box.isActive = false;
                     box.mesh.visible = false;
                     box.respawnTimer = this.itemBoxRespawnTime;
                 }
            });
        });
    }

     checkBananaCollisions() {
        const playerPos = this.kart.position;
        const kartRadius = 0.6; // Smaller radius for banana collision

        for (let i = this.droppedBananas.length - 1; i >= 0; i--) {
            const banana = this.droppedBananas[i];
            const bananaPos = banana.mesh.position;

            // Check player collision (removed owner check to allow self-hit)
            if (playerPos.distanceTo(bananaPos) < kartRadius + 0.3) { // 0.3 banana radius
                this.applyBananaHit({ mesh: this.kart });
                this.scene.remove(banana.mesh);
                this.droppedBananas.splice(i, 1);
                continue; // Move to next banana check
            }

            // Check bot collision (if not the owner)
            for (let j = 0; j < this.bots.length; j++) {
                 const bot = this.bots[j];
                 if (banana.owner !== bot && bot.mesh.position.distanceTo(bananaPos) < kartRadius + 0.3) {
                     this.applyBananaHit(bot);
                     this.scene.remove(banana.mesh);
                     this.droppedBananas.splice(i, 1);
                     break; // Bot hit it, stop checking this banana for other bots
                 }
            }
        }
    }


    // --- Kart Collision Detection and Handling ---

    checkKartCollisions() {
        const kartRadius = 1.1; // Approximate radius for collision sphere
        
        // Player vs Bots
        if (!this.playerIsInvisible) { // Player can't hit or be hit if invisible
            const playerSphere = new THREE.Sphere(this.kart.position, kartRadius);
            this.bots.forEach(bot => {
                if (!bot.isInvisible) { // Bot can't be hit if invisible
                    const botSphere = new THREE.Sphere(bot.mesh.position, kartRadius);
                    if (playerSphere.intersectsSphere(botSphere)) {
                        this.handleKartCollision(
                            { mesh: this.kart, impulse: this.impulse, speed: this.speed }, // Pass player object wrapper
                            bot // Bot object already has mesh, impulse, and speed
                        );
                    }
                }
            });
        }

        // Bots vs Bots
        for (let i = 0; i < this.bots.length; i++) {
            for (let j = i + 1; j < this.bots.length; j++) {
                const botA = this.bots[i];
                const botB = this.bots[j];

                // Skip collision if either bot is invisible
                if (botA.isInvisible || botB.isInvisible) continue;

                const sphereA = new THREE.Sphere(botA.mesh.position, kartRadius);
                const sphereB = new THREE.Sphere(botB.mesh.position, kartRadius);

                if (sphereA.intersectsSphere(sphereB)) {
                    this.handleKartCollision(botA, botB); // botA and botB already have .speed
                }
            }
        }
    }

    handleKartCollision(racerA, racerB) {
        // Use a base magnitude, potentially influenced by relative speeds later
        const bumpImpulseMagnitudeBase = 0.12; 
        
        // If one racer is significantly shrunk, they might be bumped more easily
        // or bump with less force. For now, keeping it simple.
        let magA = bumpImpulseMagnitudeBase;
        let magB = bumpImpulseMagnitudeBase;

        // Example: If racerA is shrunk, it receives a slightly larger impulse from B
        if ((racerA.mesh === this.kart && this.playerShrinkDuration > 0) || (racerA.shrinkDuration && racerA.shrinkDuration > 0)) {
            magB *= 1.3; // B pushes shrunk A more
            magA *= 0.7; // Shrunk A pushes B less
        }
        if ((racerB.mesh === this.kart && this.playerShrinkDuration > 0) || (racerB.shrinkDuration && racerB.shrinkDuration > 0)) {
            magA *= 1.3; // A pushes shrunk B more
            magB *= 0.7; // Shrunk B pushes A less
        }


        const posA = racerA.mesh.position;
        const posB = racerB.mesh.position;

        // Calculate collision normal (from B to A)
        const collisionNormal = posA.clone().sub(posB);
        collisionNormal.y = 0; // Ignore vertical difference for bump direction
        if (collisionNormal.lengthSq() === 0) {
             // Avoid division by zero if perfectly overlapped, apply a default push
             collisionNormal.set(this.playerRandom() - 0.5, 0, this.playerRandom() - 0.5);
        }
        collisionNormal.normalize();


        // Apply impulse - add to existing impulse to allow multiple bumps
        // Use potentially modified magnitudes
        const impulseForA = collisionNormal.clone().multiplyScalar(magA);
        const impulseForB = collisionNormal.clone().multiplyScalar(-magB); // Negative for opposite direction

        racerA.impulse.add(impulseForA);
        racerB.impulse.add(impulseForB);

        // Optional: Add slight speed reduction based on relative speeds or if one is boosting
        // e.g., if racerA.speed is much higher, racerB might lose more speed.
        // For now, the impulse handles the primary effect.
    }

    // --- End Collision Handling ---


    updateScoreboard() {
        if (this.raceFinished || !this.checkpoints || this.checkpoints.length === 0) return;

        // 1. Create array of all racers (player + bots) with their progress data
        const racers = [];

        // Player data
        // Use index 3 (start/finish line) if no checkpoint crossed yet (-1)
        const playerCheckpointIndex = this.lastCheckpoint === -1 ? 3 : this.lastCheckpoint;
        const playerNextCheckpointIndex = (playerCheckpointIndex + 1) % this.totalCheckpoints;
        racers.push({
            id: 'player',
            lap: this.currentLap,
            checkpointIndex: playerCheckpointIndex,
            distanceToNext: this.calculateDistanceToNextCheckpoint(this.kart.position, playerNextCheckpointIndex)
        });

        // Bot data
        this.bots.forEach((bot, index) => {
            racers.push({
                id: `bot_${index}`,
                lap: bot.lap,
                checkpointIndex: bot.currentCheckpointIndex,
                distanceToNext: this.calculateDistanceToNextCheckpoint(bot.mesh.position, bot.targetCheckpointIndex)
            });
        });

        // Log raw racer data before sorting (throttled)
        // if (this.frameCount % 60 === 0) {
            // console.log('%c--- Scoreboard Update (Frame ' + this.frameCount + ') ---', 'font-weight: bold; color: orange;');
            // console.table(racers.map(r => ({ id: r.id, lap: r.lap, checkpoint: r.checkpointIndex, distNext: r.distanceToNext.toFixed(2) })));
        // }

        // 2. Sort racers based on lap, then checkpoint (handling wrap-around), then distance
        racers.sort((a, b) => {
            // const logComparison = this.frameCount % 1 === 0; // Check if we should log this frame
            // 1. Sort by lap descending
            if (a.lap !== b.lap) {
                return b.lap - a.lap;
            }

            // 2. Laps are the same, sort by checkpoint index, handling wrap-around
            const idxA = a.checkpointIndex;
            const idxB = b.checkpointIndex;

            if (idxA === 3 && idxB !== 3) {
                return 1; // B is ahead (lower index but effectively further along this lap)
            }
            if (idxB === 3 && idxA !== 3) {
                return -1; // A is ahead
            }

            if (idxA !== idxB) {
                return idxB - idxA;
            }

            // 3. Checkpoints are also the same, sort by distance ascending (closer is better)
            return a.distanceToNext - b.distanceToNext;
        });

        // Log the final sorted order (throttled)
        // if (this.frameCount % 1 === 0) {
            // console.log('%cSorted Racers (Frame ' + this.frameCount + '):', 'font-weight: bold; color: lightgreen;');
            // console.table(racers.map(r => ({ id: r.id, lap: r.lap, checkpoint: r.checkpointIndex, distNext: r.distanceToNext.toFixed(2) })));
        // }


        // 3. Find player's position
        const playerRank = racers.findIndex(racer => racer.id === 'player') + 1;
        this.playerPosition = playerRank;

        // 4. Update display
        this.positionDisplay.textContent = this.getOrdinalSuffix(this.playerPosition);
    }

    // --- Item System Logic ---

    updateItemDisplay() {
        if (this.playerItem) {
            let itemSymbol = '?';
            if (this.playerItem === 'mushroom') itemSymbol = '🍄';
            else if (this.playerItem === 'banana') itemSymbol = '🍌';
            else if (this.playerItem === 'greenShell') itemSymbol = '🐢';
            else if (this.playerItem === 'redShell') itemSymbol = '🎯'; // Red shell symbol
            else if (this.playerItem === 'fakeItemBox') itemSymbol = '❓';
            else if (this.playerItem === 'boo') itemSymbol = '👻';
            else if (this.playerItem === 'lightningBolt') itemSymbol = '⚡';
            this.itemNameDisplay.textContent = itemSymbol;
            this.itemDisplay.classList.remove('hidden');
            this.useItemButton.classList.remove('hidden'); // Show use button if item held
        } else {
            this.itemNameDisplay.textContent = '';
            this.itemDisplay.classList.add('hidden');
            this.useItemButton.classList.add('hidden'); // Hide use button if no item
        }
    }

    giveItem(racer) {
        const isPlayer = (racer.mesh === this.kart);
        const randomFunction = isPlayer ? this.playerRandom : racer.random;

        // Determine rank for item tiering
        let rank;
        const allRacersForRanking = [{ 
            id: 'player', 
            mesh: this.kart, 
            lap: this.currentLap, 
            checkpointIndex: this.lastCheckpoint === -1 ? 3 : this.lastCheckpoint, 
            position: this.kart.position,
            isPlayer: true 
        }];

        this.bots.forEach((bot, index) => {
            allRacersForRanking.push({ 
                id: `bot_${index}`, 
                mesh: bot.mesh, 
                lap: bot.lap, 
                checkpointIndex: bot.currentCheckpointIndex, 
                position: bot.mesh.position,
                isPlayer: false,
                botRef: bot
            });
        });

        allRacersForRanking.sort((a, b) => {
            if (a.lap !== b.lap) return b.lap - a.lap;
            
            const idxA = a.checkpointIndex;
            const idxB = b.checkpointIndex;

            if (idxA === 3 && idxB !== 3 && a.lap === b.lap) return 1; 
            if (idxB === 3 && idxA !== 3 && a.lap === b.lap) return -1;
            if (idxA !== idxB) return idxB - idxA;

            const nextCheckpointIndexA = (a.checkpointIndex + 1) % this.totalCheckpoints;
            const nextCheckpointIndexB = (b.checkpointIndex + 1) % this.totalCheckpoints;
            const distA = this.calculateDistanceToNextCheckpoint(a.position, nextCheckpointIndexA);
            const distB = this.calculateDistanceToNextCheckpoint(b.position, nextCheckpointIndexB);
            return distA - distB;
        });
        
        const racerUniqueId = isPlayer ? 'player' : `bot_${this.bots.indexOf(racer)}`;
        rank = allRacersForRanking.findIndex(r => r.id === racerUniqueId) + 1;

        const totalRacers = allRacersForRanking.length;
        let availableItems;
        let chosenItem;

        if (rank === 1) {
            // console.log(`${racerUniqueId} is 1st, attempting to get Tier 1 item.`);
            const randRoll = randomFunction(); // Get a random number between 0 and 1
            if (randRoll < 0.80) { // 80% chance for banana
                chosenItem = 'banana';
            } else { // 20% chance for green shell
                chosenItem = 'greenShell';
            }
        } else if (rank === totalRacers) { // Last place
            availableItems = ['boo', 'lightningBolt', 'mushroom'];
            // console.log(`${racerUniqueId} is ${rank} (last), gets Tier 4 (Last Place) items.`);
            chosenItem = availableItems[Math.floor(randomFunction() * availableItems.length)];
        } else if (rank > Math.ceil(totalRacers / 2)) { // Back half of the pack (but not 1st or last)
            availableItems = ['mushroom', 'boo', 'fakeItemBox', 'redShell']; // Added RedShell
            // console.log(`${racerUniqueId} is ${rank} (back half), gets Tier 3 items.`);
            chosenItem = availableItems[Math.floor(randomFunction() * availableItems.length)];
        } else { // Front half of the pack (but not 1st or last)
            availableItems = ['mushroom', 'fakeItemBox', 'greenShell', 'redShell']; // Added RedShell
            // console.log(`${racerUniqueId} is ${rank} (front half), gets Tier 2 items.`);
            chosenItem = availableItems[Math.floor(randomFunction() * availableItems.length)];
        }
        
        // Fallback if chosenItem somehow didn't get set (e.g., an item tier list was empty or logic error)
        if (!chosenItem) {
            // This case should ideally not be hit if all tiers are defined and rank logic is correct.
            // It would apply if, for example, rank 1 logic failed to set chosenItem.
            console.warn(`ChosenItem was not set for rank ${rank}. Defaulting to mushroom.`);
            chosenItem = 'mushroom';
        }


        if (isPlayer) {
            if (this.playerItem === null) {
                this.playerItem = chosenItem;
                // console.log(`Player (Rank ${rank}) got item: ${this.playerItem}`);
                this.updateItemDisplay();
            }
        } else { // It's a bot
             if (racer.item === null) {
                 racer.item = chosenItem;
                 // console.log(`Bot ${this.bots.indexOf(racer)} (Rank ${rank}) got item: ${racer.item}`);
             }
        }
    }

    useItem(racer) {
        const isPlayer = (racer.mesh === this.kart);
        const itemToUse = isPlayer ? this.playerItem : racer.item;

        if (!itemToUse) return; // No item to use

        if (itemToUse !== 'boo') { // Keep Boo logs, remove others
            // console.log(`${isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} used ${itemToUse}`);
        } else {
            console.log(`${isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} used ${itemToUse}`);
        }


        if (itemToUse === 'banana') {
            this.useBanana(racer);
        } else if (itemToUse === 'mushroom') {
            this.useMushroom(racer);
        } else if (itemToUse === 'greenShell') {
            this.useGreenShell(racer);
        } else if (itemToUse === 'redShell') {
            this.useRedShell(racer);
        } else if (itemToUse === 'fakeItemBox') {
            this.useFakeItemBox(racer);
        } else if (itemToUse === 'boo') {
            this.useBoo(racer);
        } else if (itemToUse === 'lightningBolt') {
            this.useLightningBolt(racer); // Pass the user
        }

        // Clear the item after use, unless it's Boo, which handles its own slot.
        if (itemToUse !== 'boo') {
            if (isPlayer) {
                this.playerItem = null;
            } else { // It's a bot
                racer.item = null;
            }
        }

        // Always update display for player after any item use attempt
        if (isPlayer) {
            this.updateItemDisplay();
        }
    }

    useBanana(racer) {
        const bananaGeometry = new THREE.SphereGeometry(0.5, 8, 6); // Simple sphere for banana
        const bananaMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        const bananaMesh = new THREE.Mesh(bananaGeometry, bananaMaterial);

        // Position slightly behind the racer
        const backwardOffset = -2.0;
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
        const dropPosition = racer.mesh.position.clone().addScaledVector(forward, backwardOffset);
        dropPosition.y = 0.3; // Place on track

        bananaMesh.position.copy(dropPosition);
        this.scene.add(bananaMesh);

        this.droppedBananas.push({ mesh: bananaMesh, owner: racer }); // Store mesh and who dropped it
    }

    useMushroom(racer) {
        const isPlayer = (racer.mesh === this.kart);
        if (isPlayer) {
            this.playerMushroomBoostDuration = this.mushroomBoostTime;
            this.boosting = false; // Mushroom overrides mini-turbo boost
            this.boostTime = 0;
        } else {
            racer.mushroomBoostDuration = this.mushroomBoostTime;
            racer.boosting = false; // Mushroom overrides mini-turbo boost
            racer.boostTime = 0;
        }
    }

    applyBananaHit(racer) {
        const isPlayer = (racer.mesh === this.kart);
        // console.log(`${isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} hit a banana!`);

        if (isPlayer) {
            if (this.playerIsInvisible) return; // Immune if Boo is active
            this.playerStunDuration = this.bananaStunTime;
            this.speed *= 0.3; // Drastically reduce speed, not full stop
            this.playerMushroomBoostDuration = 0; 
            this.boosting = false; 
            this.isDrifting = false; 
            this.driftActive = false;
        } else {
            if (racer.isInvisible) return; // Immune if Boo is active
            racer.stunDuration = this.bananaStunTime;
            racer.speed *= 0.3;
            racer.mushroomBoostDuration = 0;
            racer.boosting = false;
            racer.isDrifting = false;
        }
    }

    applyRedShellHit(racer) {
        const isPlayer = (racer.mesh === this.kart);
        // console.log(`${isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} hit by a Red Shell!`);

        if (isPlayer) {
            if (this.playerIsInvisible) return; // Immune if Boo is active
            this.playerStunDuration = this.redShellStunTime;
            this.speed *= 0.25; // Significant speed reduction
            this.playerMushroomBoostDuration = 0; 
            this.boosting = false; 
            this.isDrifting = false; 
            this.driftActive = false;
        } else { // Bot
            // Ensure 'racer' is the full bot object if it's a bot
            const botRacer = racer.isPlayer === false ? racer.botRef : racer; 
            if (botRacer.isInvisible) return; // Immune if Boo is active
            botRacer.stunDuration = this.redShellStunTime;
            botRacer.speed *= 0.25;
            botRacer.mushroomBoostDuration = 0;
            botRacer.boosting = false;
            botRacer.isDrifting = false;
        }
    }

    // --- Green Shell Logic ---
    useGreenShell(racer) {
        const shellGeometry = new THREE.SphereGeometry(0.6, 8, 6);
        const shellMaterial = new THREE.MeshBasicMaterial({ color: 0x00cc00 }); // Green
        const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);

        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
        let fireDirection = forward.clone();
        
        // Basic check: if racer is player and holding 's' or backward touch, fire backward
        const isPlayer = (racer.mesh === this.kart);
        if (isPlayer && (this.keys['s'] || this.touchControls.backward)) {
            fireDirection.negate();
        }
        // Bot simple decision (could be smarter)
        if (!isPlayer && racer.random() < 0.3) { // 30% chance to fire backward if bot
            fireDirection.negate();
        }


        const spawnPosition = racer.mesh.position.clone().addScaledVector(fireDirection, 1.5);
        spawnPosition.y = 0.5; // Height of shell

        shellMesh.position.copy(spawnPosition);
        this.scene.add(shellMesh);

        const shellSpeed = this.maxSpeed * 1.5; // Green shell speed is 1.5x player's maxSpeed

        this.activeGreenShells.push({
            mesh: shellMesh,
            velocity: fireDirection.multiplyScalar(shellSpeed),
            owner: racer,
            bouncesLeft: this.greenShellBounces,
            lifetime: this.greenShellLifetime
        });
    }

    applyGreenShellHit(racer) {
        const isPlayer = (racer.mesh === this.kart);
        // console.log(`${isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} hit by a Green Shell!`);

        if (isPlayer) {
            if (this.playerIsInvisible) return;
            this.playerStunDuration = this.greenShellStunTime;
            this.speed *= 0.2;
            this.playerMushroomBoostDuration = 0;
            this.boosting = false;
            this.isDrifting = false;
            this.driftActive = false;
        } else {
            if (racer.isInvisible) return;
            racer.stunDuration = this.greenShellStunTime;
            racer.speed *= 0.2;
            racer.mushroomBoostDuration = 0;
            racer.boosting = false;
            racer.isDrifting = false;
        }
    }

    // --- Red Shell Logic ---
    useRedShell(racer) {
        const isPlayerFirer = (racer.mesh === this.kart);
        let firerRankData;

        if (isPlayerFirer) {
            // Simplified rank finding for player - find player in sorted list
            const allRacersSorted = this.getBotRankAndRacers(null).sortedRacers; // Pass null as bot if getting for player context
            const playerRankIndex = allRacersSorted.findIndex(r => r.id === 'player');
            firerRankData = { rank: playerRankIndex + 1, sortedRacers: allRacersSorted, firerObj: allRacersSorted[playerRankIndex].obj };
        } else { // Bot is firer
            firerRankData = this.getBotRankAndRacers(racer); // racer is the bot object
        }

        let target = null;
        // Find the racer directly ahead of the firer who is not invisible
        if (firerRankData.rank > 1) { // If not in 1st place
            for (let i = firerRankData.rank - 2; i >= 0; i--) { // rank is 1-based, array is 0-based
                const potentialTarget = firerRankData.sortedRacers[i].obj;
                if (!potentialTarget.isInvisible) {
                    target = potentialTarget; // Target is the racer object {mesh, lap, ...}
                    break;
                }
            }
        }

        if (!target) {
            // console.log("Red Shell: No valid target ahead or firer is in 1st. Item returned.");
            if (isPlayerFirer) {
                if (this.playerItem === null) { // Only give back if slot is now empty (e.g. if useItem cleared it)
                    this.playerItem = 'redShell'; 
                    this.updateItemDisplay();
                }
            } else {
                if (racer.item === null) { // Bot racer
                    racer.item = 'redShell';
                }
            }
            return; 
        }

        // console.log(`${isPlayerFirer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} fires Red Shell at ${target.isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(target.botRef)}`);

        const shellGeometry = new THREE.SphereGeometry(0.6, 8, 6);
        const shellMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red
        const shellMesh = new THREE.Mesh(shellGeometry, shellMaterial);

        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
        const spawnPosition = racer.mesh.position.clone().addScaledVector(forward, 1.5);
        spawnPosition.y = 0.5; // Height of shell

        shellMesh.position.copy(spawnPosition);
        this.scene.add(shellMesh);

        this.activeRedShells.push({
            mesh: shellMesh,
            owner: racer, 
            target: target, // Store the racer object for the target
            lifetime: this.redShellLifetime,
            speed: this.maxSpeed * 1.5 // Same speed as green shells
        });
    }

    updateRedShells(deltaTime) {
        const shellRadius = 0.6;

        for (let i = this.activeRedShells.length - 1; i >= 0; i--) {
            const shell = this.activeRedShells[i];
            shell.lifetime -= deltaTime;

            // Target validation: Ensure target.mesh exists and target is not invisible
            if (shell.lifetime <= 0 || !shell.target || !shell.target.mesh || shell.target.isInvisible) {
                this.scene.remove(shell.mesh);
                this.activeRedShells.splice(i, 1);
                continue;
            }
            
            const shellPos = shell.mesh.position;
            const targetPos = shell.target.mesh.position; // Target is a racer object like {mesh: ..., ...}

            // Homing logic
            const directionToTarget = new THREE.Vector3().subVectors(targetPos, shellPos);
            directionToTarget.y = 0; 
            directionToTarget.normalize();

            shell.mesh.lookAt(targetPos.x, shellPos.y, targetPos.z); 
            const moveDirection = new THREE.Vector3(0,0,1).applyQuaternion(shell.mesh.quaternion);

            const moveAmountVec = moveDirection.clone().multiplyScalar(shell.speed);
            const prevPos = shellPos.clone();
            
            this.raycaster.set(prevPos, moveDirection);
            this.raycaster.far = shell.speed + shellRadius;
            const wallIntersects = this.raycaster.intersectObjects(this.wallMeshes);

            if (wallIntersects.length > 0 && wallIntersects[0].distance - shellRadius < shell.speed) {
                this.scene.remove(shell.mesh);
                this.activeRedShells.splice(i, 1);
                continue;
            }

            shellPos.add(moveAmountVec);
            shellPos.y = 0.5; 

            // Collision with target
            if (shellPos.distanceTo(targetPos) < 1.0) { 
                this.applyRedShellHit(shell.target); // Pass the racer object stored in shell.target
                this.scene.remove(shell.mesh);
                this.activeRedShells.splice(i, 1);
                continue;
            }

            // Collision with other racers (not owner, not target, not invisible)
            const allOtherRacers = [];
            // Check player
            if (shell.owner.mesh !== this.kart && shell.target.mesh !== this.kart && !this.playerIsInvisible) {
                 allOtherRacers.push({mesh: this.kart, isPlayer: true, botRef: null, isInvisible: this.playerIsInvisible}); // Add player as potential victim
            }
            // Check bots
            this.bots.forEach(bot => {
                if (shell.owner !== bot && shell.target.botRef !== bot && !bot.isInvisible) { // Ensure bot itself is not the target
                    allOtherRacers.push({mesh: bot.mesh, isPlayer: false, botRef: bot, isInvisible: bot.isInvisible}); // Add bot as potential victim
                }
            });

            for (const otherRacer of allOtherRacers) {
                if (shellPos.distanceTo(otherRacer.mesh.position) < 1.0) {
                    this.applyRedShellHit(otherRacer); // Pass the simple racer object
                    this.scene.remove(shell.mesh);
                    this.activeRedShells.splice(i, 1);
                    break; 
                }
            }
            if (this.activeRedShells.indexOf(shell) === -1) continue;

            // Collision with bananas or fake item boxes
            const itemsToAvoid = [...this.droppedBananas, ...this.droppedFakeItemBoxes];
            for (let k = itemsToAvoid.length - 1; k >= 0; k--) {
                const item = itemsToAvoid[k];
                if (shellPos.distanceTo(item.mesh.position) < 0.8) { 
                    this.scene.remove(shell.mesh);
                    this.activeRedShells.splice(i, 1);
                    this.scene.remove(item.mesh); 
                    if (this.droppedBananas.includes(item)) this.droppedBananas.splice(this.droppedBananas.indexOf(item), 1);
                    if (this.droppedFakeItemBoxes.includes(item)) this.droppedFakeItemBoxes.splice(this.droppedFakeItemBoxes.indexOf(item), 1);
                    break; 
                }
            }
             if (this.activeRedShells.indexOf(shell) === -1) continue;


            // Collision with green shells
            for (let k = this.activeGreenShells.length - 1; k >= 0; k--) {
                const greenShell = this.activeGreenShells[k];
                if (shellPos.distanceTo(greenShell.mesh.position) < 1.2) { 
                    this.scene.remove(shell.mesh);
                    this.activeRedShells.splice(i, 1);
                    this.scene.remove(greenShell.mesh); 
                    this.activeGreenShells.splice(k, 1);
                    break;
                }
            }
             if (this.activeRedShells.indexOf(shell) === -1) continue;

        }
    }

    // --- Fake Item Box Logic ---
    useFakeItemBox(racer) {
        const boxGeometry = new THREE.BoxGeometry(1.8, 1.8, 1.8); // Slightly smaller than real box
        // Red question mark texture for fake item boxes
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(200, 0, 0, 0.7)'; // Semi-transparent red background
        ctx.fillRect(0,0,64,64);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 48px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 32, 36);
        const texture = new THREE.CanvasTexture(canvas);
        const boxMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

        const fakeBoxMesh = new THREE.Mesh(boxGeometry, boxMaterial);

        const backwardOffset = -2.5;
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(racer.mesh.quaternion);
        const dropPosition = racer.mesh.position.clone().addScaledVector(forward, backwardOffset);
        dropPosition.y = 1.0; // Same height as real item boxes

        fakeBoxMesh.position.copy(dropPosition);
        this.scene.add(fakeBoxMesh);
        this.droppedFakeItemBoxes.push({ mesh: fakeBoxMesh, owner: racer });
    }

    applyFakeItemBoxHit(racer) {
        const isPlayer = (racer.mesh === this.kart);
        // console.log(`${isPlayer ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} hit a Fake Item Box!`);
        if (isPlayer) {
            if (this.playerIsInvisible) return;
            this.playerStunDuration = this.fakeItemBoxStunTime;
            this.speed *= 0.7; // Minor speed reduction
        } else {
            if (racer.isInvisible) return;
            racer.stunDuration = this.fakeItemBoxStunTime;
            racer.speed *= 0.7;
        }
    }

    // --- Boo (Ghost) Logic ---
    useBoo(racer) {
        const isPlayerBooUser = (racer.mesh === this.kart);
        console.log(`${isPlayerBooUser ? 'Player' : 'Bot ' + this.bots.indexOf(racer)} used Boo!`); // KEEP THIS LOG

        if (isPlayerBooUser) {
            this.playerIsInvisible = true;
            this.playerInvisibilityDuration = this.booDuration;
            this.playerIsAttemptingBooSteal = true; // Flag for delayed steal
            this.kart.traverse(child => {
                if (child.isMesh) {
                    child.material.transparent = true;
                    child.material.opacity = 0.4;
                }
            });
        } else { // It's a bot
            racer.isInvisible = true;
            racer.invisibilityDuration = this.booDuration;
            racer.isAttemptingBooSteal = true; // Flag for delayed steal
            racer.mesh.traverse(child => {
                if (child.isMesh) {
                    child.material.transparent = true;
                    child.material.opacity = 0.4;
                }
            });
        }
        // The 'boo' item remains in the slot. Stealing and item slot update will happen in updateKart/updateBots.
        // The player's item display will be updated by the calling useItem function, showing 'boo'.
    }
    
    stealItemWithBoo(thief) {
        let racersToTarget = [];
        let itemWasStolen = false;
        // Determine if the thief is the player.
        // 'thief' will be 'this.kart' (the THREE.Group) if player, or a bot object if bot.
        const isThiefThePlayer = (thief === this.kart);
        
        console.log(`Boo logic: Thief is ${isThiefThePlayer ? 'Player' : `Bot ${this.bots.indexOf(thief)}`}`);

        // Determine which PRNG to use for target selection
        const randomFunctionForTargetSelection = isThiefThePlayer ? this.playerRandom : thief.random;

        if (isThiefThePlayer) { // Player is the thief
            racersToTarget = this.bots.filter(b => b.item !== null && !b.isInvisible);
        } else { // Bot is the thief (thief is a bot object)
            if (this.playerItem !== null && !this.playerIsInvisible) {
                 racersToTarget.push({racerObj: this, itemHolder: 'player'}); // Target player
            }
            racersToTarget.push(...this.bots.filter(b => b !== thief && b.item !== null && !b.isInvisible).map(b => ({racerObj: b, itemHolder: 'bot'})));
        }
        
        const targetDetails = racersToTarget.map(t_or_w => {
            // If isThiefThePlayer is true, racersToTarget contains bot objects (t_or_w is a bot)
            // If isThiefThePlayer is false, racersToTarget contains wrapper objects (t_or_w is a wrapper)
            if (isThiefThePlayer) { 
                return `Bot ${this.bots.indexOf(t_or_w)} (Item: ${t_or_w.item})`;
            } else { 
                const itemHolder = t_or_w.itemHolder;
                if (itemHolder === 'player') {
                    return `Player (Item: ${this.playerItem})`;
                } else { 
                    const botVictim = t_or_w.racerObj;
                    return `Bot ${this.bots.indexOf(botVictim)} (Item: ${botVictim.item})`;
                }
            }
        });
        console.log("Boo logic: Potential targets:", targetDetails.length > 0 ? targetDetails : "None");

        if (racersToTarget.length > 0) {
            // Use the determined PRNG for target selection
            const selectedTargetData = racersToTarget[Math.floor(randomFunctionForTargetSelection() * racersToTarget.length)];
            let stolenItemValue = null; // Temporary variable to hold the item string
            let victimLogName = "Unknown";

            if (isThiefThePlayer) { // Player is the thief, selectedTargetData is a direct bot object
                const victimBot = selectedTargetData;
                // The filter `b.item !== null` should ensure victimBot.item is truthy if a target is found.
                if (victimBot.item) { 
                    stolenItemValue = victimBot.item;
                    victimBot.item = null; // Remove item from victim bot
                    itemWasStolen = true;
                    victimLogName = `Bot ${this.bots.indexOf(victimBot)}`;
                }
            } else { // Bot is the thief, selectedTargetData is {racerObj: ..., itemHolder: ...}
                const victimWrapper = selectedTargetData;
                if (victimWrapper.itemHolder === 'player') {
                    // The filter `this.playerItem !== null` should ensure this.playerItem is truthy.
                    if (this.playerItem) { 
                        stolenItemValue = this.playerItem;
                        this.playerItem = null; // Remove item from player
                        this.updateItemDisplay(); // Victim player updates their display
                        itemWasStolen = true;
                        victimLogName = "Player";
                    }
                } else { // Victim is another bot
                    const victimBot = victimWrapper.racerObj;
                    // The filter `b.item !== null` should ensure victimBot.item is truthy.
                    if (victimBot.item) { 
                        stolenItemValue = victimBot.item;
                        victimBot.item = null; // Remove item from victim bot
                        itemWasStolen = true;
                        victimLogName = `Bot ${this.bots.indexOf(victimBot)}`;
                    }
                }
            }
            
            if (itemWasStolen) { // If a steal was successful
                console.log(`Boo stole ${stolenItemValue} from ${victimLogName}!`);
                // Give stolen item to thief
                if (isThiefThePlayer) { // Player is the thief
                    this.playerItem = stolenItemValue;
                    this.updateItemDisplay(); // Thief player updates their display with the new item
                } else { // Bot is the thief (thief is a bot object)
                    thief.item = stolenItemValue;
                }
            }
        }
        
        if (!itemWasStolen) {
            // No item was stolen, give a mushroom to the thief instead.
            const mushroomItem = 'mushroom';
            if (isThiefThePlayer) {
                this.playerItem = mushroomItem;
                this.updateItemDisplay(); // Thief player updates their display
                console.log("Boo couldn't find an item to steal! Player received a mushroom instead.");
            } else { // Bot is the thief
                thief.item = mushroomItem;
                console.log(`Boo couldn't find an item to steal! Bot ${this.bots.indexOf(thief)} received a mushroom instead.`);
            }
            // Even though no item was 'stolen' in the traditional sense,
            // the Boo user *did* receive an item as a result of using Boo.
            // We can return true here if we consider receiving a mushroom as a "successful" outcome for the Boo user.
            // Or return false if "stolen" strictly means taking from another racer.
            // For now, let's keep itemWasStolen as is, reflecting the steal attempt itself.
            // The calling function (useBoo) will handle consuming the original 'boo' based on the original logic.
            // The key change here is that the slot is now filled with 'mushroom' if steal fails.
        }
        return itemWasStolen; // Returns true if an item was stolen from another racer, false otherwise.
    }


    // --- Lightning Bolt Logic ---
    useLightningBolt(firer) { // Firer is the racer who used the lightning
        // console.log(`${firer.mesh === this.kart ? 'Player' : 'Bot ' + this.bots.indexOf(firer)} used Lightning Bolt!`);

        // Affect player if not the firer
        if (firer.mesh !== this.kart) {
            if (!this.playerIsInvisible) { // Boo immunity
                // console.log("Player struck by lightning!");
                this.playerShrinkDuration = this.lightningShrinkDuration;
                this.playerStunDuration = Math.max(this.playerStunDuration, this.lightningStunTime); // Apply stun
                this.speed *= 0.4; // Reduce speed significantly
                this.kart.scale.set(this.originalPlayerScale.x * this.lightningShrinkScaleFactor, this.originalPlayerScale.y * this.lightningShrinkScaleFactor, this.originalPlayerScale.z * this.lightningShrinkScaleFactor);
                if (this.playerItem) { // Lose item
                    // console.log(`Player lost item: ${this.playerItem}`);
                    this.playerItem = null;
                    this.updateItemDisplay();
                }
            }
        }

        // Affect bots if not the firer
        this.bots.forEach((bot, index) => {
            if (firer !== bot) { // Don't affect the bot that fired it
                if (!bot.isInvisible) { // Boo immunity
                    // console.log(`Bot ${index} struck by lightning!`);
                    bot.shrinkDuration = this.lightningShrinkDuration;
                    bot.stunDuration = Math.max(bot.stunDuration, this.lightningStunTime);
                    bot.speed *= 0.4;
                    bot.mesh.scale.set(bot.originalScale.x * this.lightningShrinkScaleFactor, bot.originalScale.y * this.lightningShrinkScaleFactor, bot.originalScale.z * this.lightningShrinkScaleFactor);
                    if (bot.item) { // Lose item
                        // console.log(`Bot ${index} lost item: ${bot.item}`);
                        bot.item = null;
                    }
                }
            }
        });
    }


    // --- End Item System Logic ---


    updateBots(deltaTime) { // Accept deltaTime
        // Only allow updates if the race is active
        if (this.gameState !== 'racing') return;

        const arrivalThreshold = 3.0; // How close the bot needs to be to the *actual* checkpoint center
        const lookAheadDistance = 10.0; // How far ahead the bot looks for steering
        const botUseItemChance = 0.015; // Slightly increased chance

        this.bots.forEach((bot, botIndex) => {
            // --- Handle Bot Effects (Boo, Lightning, Stun) ---
            if (bot.isInvisible) { // Handles Boo invisibility primarily
                bot.invisibilityDuration -= deltaTime;

                if (bot.invisibilityDuration <= 0) {
                    // Invisibility duration from Boo has ended for the bot.
                    if (bot.isAttemptingBooSteal) {
                        const itemStolenSuccessfully = this.stealItemWithBoo(bot);

                        if (itemStolenSuccessfully) {
                            // stealItemWithBoo already put the item in bot.item (stolen item)
                            console.log(`Boo stole ${bot.item} for Bot ${botIndex}!`);
                            bot.invisibilityDuration = 0; // End invisibility due to successful steal
                        } else {
                            // Steal from another racer failed. stealItemWithBoo has given the bot a 'mushroom'.
                            // bot.item is already 'mushroom'. Invisibility continues for its normal duration.
                            // The console log for receiving a mushroom is in stealItemWithBoo.
                            console.log(`Bot ${botIndex}'s Boo failed to steal from another; bot received a mushroom. Invisibility continues.`);
                        }
                        bot.isAttemptingBooSteal = false;
                    }

                    // Restore visibility unless another effect keeps bot invisible
                    bot.isInvisible = false;
                    bot.mesh.traverse(child => {
                        if (child.isMesh) {
                            child.material.opacity = 1.0;
                            // Consider if material was originally transparent
                        }
                    });
                }
            }
            if (bot.shrinkDuration > 0) {
                bot.shrinkDuration -= deltaTime;
                if (bot.shrinkDuration <= 0) {
                    bot.mesh.scale.copy(bot.originalScale); // Restore scale
                }
            }
            if (bot.stunDuration > 0) {
                bot.stunDuration -= deltaTime;
                // Bot is stunned, reduce speed significantly, limit further actions
                bot.speed *= 0.95; // Rapidly decelerate if stunned
                if (bot.stunDuration <= 0) { /* stun just ended */ }
                 // If stunned, skip normal AI for this frame
                // Move the bot based on its (rapidly decaying) speed and current rotation
                const moveDirectionStunned = new THREE.Vector3(Math.sin(bot.mesh.rotation.y), 0, Math.cos(bot.mesh.rotation.y));
                bot.mesh.position.addScaledVector(moveDirectionStunned, bot.speed);
                bot.mesh.position.add(bot.impulse); // Still apply physics impulses
                bot.impulse.multiplyScalar(bot.impulseDecay);
                return;
            }

            if (!this.checkpoints || this.checkpoints.length < 2) return; // Need at least 2 checkpoints

            const currentCheckpointIndex = bot.currentCheckpointIndex;
            const targetCheckpointIndex = bot.targetCheckpointIndex;
            const nextTargetCheckpointIndex = (targetCheckpointIndex + 1) % this.totalCheckpoints;

            const currentCheckpoint = this.checkpoints[currentCheckpointIndex];
            if (!this.racingLinePoints || this.racingLinePoints.length < 2) return; // Need path points

            // Store previous position for checkpoint crossing detection
            const prevPosition = bot.prevPosition || bot.mesh.position.clone();

            // --- Path Following Logic ---

            // 1. Find the closest point segment on the racing line path
            let closestPointIndex = -1;
            let minDistanceSq = Infinity;
            const botPosXZ = new THREE.Vector2(bot.mesh.position.x, bot.mesh.position.z);

            for (let i = 0; i < this.racingLinePoints.length; i++) {
                const p1 = this.racingLinePoints[i];
                const p2 = this.racingLinePoints[(i + 1) % this.racingLinePoints.length]; // Wrap around for loop
                const p1_xz = new THREE.Vector2(p1.x, p1.z);
                const p2_xz = new THREE.Vector2(p2.x, p2.z);

                // Project bot position onto the line segment
                const segmentVector = new THREE.Vector2().subVectors(p2_xz, p1_xz);
                const botToP1 = new THREE.Vector2().subVectors(botPosXZ, p1_xz);
                let t = botToP1.dot(segmentVector) / segmentVector.lengthSq();
                t = Math.max(0, Math.min(1, t)); // Clamp t to the segment

                const closestPointOnSegment = p1_xz.clone().addScaledVector(segmentVector, t);
                const distSq = botPosXZ.distanceToSquared(closestPointOnSegment);

                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    closestPointIndex = i;
                }
            }

            // 2. Calculate look-ahead distance based on speed
            const lookAheadDistance = bot.speed * 15 + 8; // Adjust multiplier and base distance as needed

            // 3. Find the look-ahead point on the path
            let currentDistance = 0;
            let lookAheadPointIndex = closestPointIndex;
            let lookAheadPoint = this.racingLinePoints[lookAheadPointIndex].clone(); // Start with closest point

            while (currentDistance < lookAheadDistance) {
                const p1 = this.racingLinePoints[lookAheadPointIndex];
                const p2 = this.racingLinePoints[(lookAheadPointIndex + 1) % this.racingLinePoints.length];
                const segmentLength = p1.distanceTo(p2);

                if (currentDistance + segmentLength >= lookAheadDistance) {
                    // Target point is on this segment
                    const remainingDistance = lookAheadDistance - currentDistance;
                    const t = remainingDistance / segmentLength;
                    lookAheadPoint.lerpVectors(p1, p2, t);
                    break;
                } else {
                    // Move to the next segment
                    currentDistance += segmentLength;
                    lookAheadPointIndex = (lookAheadPointIndex + 1) % this.racingLinePoints.length;
                    lookAheadPoint = this.racingLinePoints[lookAheadPointIndex].clone(); // Ensure we don't overshoot last point
                     // Safety break for very short paths or large lookahead distances
                     if (lookAheadPointIndex === closestPointIndex && currentDistance > 0) break;
                }
            }


            // 4. Calculate path direction at look-ahead point
            const nextLookAheadIndex = (lookAheadPointIndex + 1) % this.racingLinePoints.length;
            const pathDirection = this.racingLinePoints[nextLookAheadIndex].clone().sub(this.racingLinePoints[lookAheadPointIndex]);
            pathDirection.y = 0;
            pathDirection.normalize();

            // 5. Calculate sideways offset vector (perpendicular to path direction)
            const sidewaysOffsetVector = new THREE.Vector3(pathDirection.z, 0, -pathDirection.x);

            // --- Dynamic Offset Calculation (same as before) ---
            bot.dynamicOffsetTimer += deltaTime;
            if (bot.dynamicOffsetTimer >= bot.dynamicOffsetUpdateTime) {
                const maxDynamicOffset = 4.0;
                const changeAmount = (bot.random() - 0.5) * 3.0;
                bot.dynamicTargetOffset = Math.max(-maxDynamicOffset, Math.min(maxDynamicOffset, bot.dynamicTargetOffset + changeAmount));
                bot.dynamicOffsetTimer = 0;
            }

            // 6. Calculate the final steering target point with offsets applied to the look-ahead point
            const totalOffset = bot.stats.targetOffset + bot.dynamicTargetOffset;
            const steeringTargetPoint = lookAheadPoint.clone()
                .addScaledVector(sidewaysOffsetVector, totalOffset);
            steeringTargetPoint.y = bot.mesh.position.y; // Keep target at bot's height


            // --- Steering (same logic, new target) ---
            const directionToTarget = steeringTargetPoint.clone().sub(bot.mesh.position);
            directionToTarget.y = 0;
            directionToTarget.normalize();

            const desiredAngle = Math.atan2(directionToTarget.x, directionToTarget.z);
            let angleDifference = desiredAngle - bot.mesh.rotation.y;
            // Normalize angle difference to [-PI, PI]
            while (angleDifference < -Math.PI) angleDifference += Math.PI * 2;
            while (angleDifference > Math.PI) angleDifference -= Math.PI * 2;

            // Apply turn rate, clamping the change
            const turnAmount = Math.max(-bot.stats.turnRate, Math.min(bot.stats.turnRate, angleDifference));
            bot.mesh.rotation.y += turnAmount;

            // --- Bot Drift Logic ---
            const driftTurnThreshold = Math.PI / 6; // Angle difference to initiate/maintain drift (30 degrees)
            const driftSpeedThreshold = bot.stats.maxSpeed * 0.5; // Minimum speed to drift

            // Decide whether to start/stop drifting
            if (!bot.isDrifting && Math.abs(angleDifference) > driftTurnThreshold && bot.speed > driftSpeedThreshold) {
                // Start drifting
                bot.isDrifting = true;
                bot.driftTime = 0;
                bot.miniTurboStage = 0;
                // console.log(`Bot ${this.bots.indexOf(bot)} started drifting`);
            } else if (bot.isDrifting && Math.abs(angleDifference) < driftTurnThreshold * 0.8) { // Stop if angle straightens out a bit
                // Stop drifting - check for boost release
                bot.isDrifting = false;
                if (bot.driftTime > this.miniTurboThresholds[1]) { // Check if stage 1 (blue) or higher was reached
                    bot.boosting = true;
                    // Use player's boost durations for now
                    bot.boostTime = this.miniTurboBoostDurations[bot.miniTurboStage - 1];
                    // console.log(`Bot ${this.bots.indexOf(bot)} released boost stage ${bot.miniTurboStage}`);
                }
                bot.driftTime = 0;
                bot.miniTurboStage = 0;
            }

            // Charge mini-turbo while drifting
            if (bot.isDrifting) {
                const chargeRate = Math.min(1.0, Math.abs(angleDifference) / (Math.PI / 4)); // Charge faster for sharper turns (up to 45 deg)
                bot.driftTime += deltaTime * chargeRate; // Use deltaTime

                // Update mini-turbo stage based on drift time
                for (let i = this.miniTurboThresholds.length - 1; i >= 0; i--) {
                    if (bot.driftTime >= this.miniTurboThresholds[i]) {
                        bot.miniTurboStage = i;
                        break;
                    }
                }

                // Emit sparks for bots based on mini-turbo stage
                if (bot.miniTurboStage > 0) {
                    const now = performance.now() / 1000; // Time in seconds
                    const timeSinceLastEmit = now - bot.lastSparkEmitTime;
                    const emitInterval = 1 / this.sparkEmitRate; // Use the same rate as player

                    if (timeSinceLastEmit >= emitInterval) {
                        const sparkColor = this.sparkColors[bot.miniTurboStage - 1];
                        // Call the modified function with bot's mesh, speed, and its PRNG
                        this.emitDriftSpark(sparkColor, bot.mesh, bot.speed, bot.random);
                        bot.lastSparkEmitTime = now; // Update the bot's specific timer
                    }
                }
            }

            // Update boost timer
            if (bot.boosting) {
                bot.boostTime -= deltaTime;
                if (bot.boostTime <= 0) {
                    bot.boosting = false;
                    // console.log(`Bot ${this.bots.indexOf(bot)} boost ended`);
                }
            }

            // --- Speed and Movement ---
            let currentMaxSpeed = bot.stats.maxSpeed;
            // Apply drift speed reduction
            if (bot.isDrifting) {
                currentMaxSpeed *= this.driftSpeedMultiplier; 
            }
            // Apply shrink penalty from lightning
            if (bot.shrinkDuration > 0) {
                currentMaxSpeed *= 0.6; // Reduced speed while shrunk
            }
            // Apply Mushroom boost (potentially overrides mini-turbo boost multiplier)
            let currentBoostMultiplier = 1.0;
            if (bot.mushroomBoostDuration > 0) {
                bot.mushroomBoostDuration -= deltaTime;
                currentBoostMultiplier = this.mushroomBoostMultiplier;
            } else if (bot.boosting) { // Apply mini-turbo boost only if mushroom isn't active
                 currentBoostMultiplier = this.boostMultiplier;
            }
            currentMaxSpeed *= currentBoostMultiplier;


            // Reduce max speed based on the sharpness of the required turn (apply *after* drift/boost mods)
            // Calculate how much the bot needs to turn (0 = straight, 1 = 90 degrees or more)
            const turnSharpnessFactor = Math.min(1.0, Math.abs(angleDifference) / (Math.PI / 2));
            // Reduce speed for sharper turns, but slightly less aggressively (e.g., up to 40% reduction for 90+ deg)
            currentMaxSpeed *= (1.0 - turnSharpnessFactor * 0.4); // Was 0.5

            // Accelerate towards (potentially reduced) max speed
            // Allow slight overspeeding temporarily if boosting/coming out of drift before speed reduction fully applies
            const targetSpeed = currentMaxSpeed;
            if (bot.speed < targetSpeed) {
                 bot.speed = Math.min(targetSpeed, bot.speed + bot.stats.acceleration);
            } else if (bot.speed > targetSpeed) {
                // Decelerate towards target speed if currently faster (e.g., after boost ends)
                // Use a deceleration factor slightly faster than normal acceleration
                bot.speed = Math.max(targetSpeed, bot.speed - bot.stats.acceleration * 1.5);
            }

            // Move bot forward based on its current rotation
            const moveDirection = new THREE.Vector3(
                Math.sin(bot.mesh.rotation.y),
                0,
                Math.cos(bot.mesh.rotation.y)
            );
            
            const botMovementThisFrame = moveDirection.clone().multiplyScalar(bot.speed);

            const botCollidedWithWall = this.handleWallCollisions(
                bot, // bot object already has .mesh, .speed, .impulse
                botMovementThisFrame,
                this.kartRadius // Assuming bot radius is same as player
            );

            if (!botCollidedWithWall) {
                bot.mesh.position.add(botMovementThisFrame);
            }

            // Apply bump impulse (still applies even if wall-collided)
            bot.mesh.position.add(bot.impulse);
            // Decay impulse
            bot.impulse.multiplyScalar(bot.impulseDecay);
            if (bot.impulse.lengthSq() < 0.0001) {
                bot.impulse.set(0, 0, 0); // Reset if very small
            }


            // --- Check Checkpoint Crossings - IMPROVED DETECTION ---
            // Check all checkpoints, similar to how we do for the player
            for (let i = 0; i < this.checkpoints.length; i++) {
                const checkpoint = this.checkpoints[i];
                
                // Get checkpoint information - same as in player checkpoint detection
                const checkpointCenter = new THREE.Vector3(
                    (checkpoint.posts[0].position.x + checkpoint.posts[1].position.x) / 2,
                    (checkpoint.posts[0].position.y + checkpoint.posts[1].position.y) / 2,
                    (checkpoint.posts[0].position.z + checkpoint.posts[1].position.z) / 2
                );
                const checkpointNormal = checkpoint.normal;
                const checkpointWidth = checkpoint.posts[0].position.distanceTo(checkpoint.posts[1].position);
                
                // Use vector crossing detection similar to player's checkpoint detection
                const vecToPrevPos = new THREE.Vector3(
                    prevPosition.x - checkpointCenter.x,
                    0,
                    prevPosition.z - checkpointCenter.z
                );
                const vecToCurrPos = new THREE.Vector3(
                    bot.mesh.position.x - checkpointCenter.x,
                    0,
                    bot.mesh.position.z - checkpointCenter.z
                );
                
                // Check if bot crossed the plane
                const prevDot = vecToPrevPos.dot(checkpointNormal);
                const currDot = vecToCurrPos.dot(checkpointNormal);
                
                // If sign changed, the bot crossed the checkpoint plane
                if (Math.sign(prevDot) !== Math.sign(currDot) && prevDot !== 0 && currDot !== 0) {
                    // Calculate the intersection point on the plane
                    const t = prevDot / (prevDot - currDot); // Interpolation factor
                    const intersectionPoint = new THREE.Vector3().lerpVectors(prevPosition, bot.mesh.position, t);
                    
                    // Vector from checkpoint center to intersection point
                    const vecCenterToIntersection = new THREE.Vector3().subVectors(intersectionPoint, checkpointCenter);
                    
                    // Get vector perpendicular to normal for gate width
                    const checkpointDirection = new THREE.Vector3(checkpointNormal.z, 0, -checkpointNormal.x).normalize();
                    
                    // Calculate distance along gate
                    const distanceAlongGate = vecCenterToIntersection.dot(checkpointDirection);
                    
                    // Check if intersection is within gate width
                    if (Math.abs(distanceAlongGate) < checkpointWidth / 2) {
                        // Check if this is the expected next checkpoint
                        if (i === bot.targetCheckpointIndex) {
                            // Remember current checkpoint index and update target
                            bot.currentCheckpointIndex = i;
                            bot.targetCheckpointIndex = (i + 1) % this.totalCheckpoints;
                            
                            // Check for lap completion
                            if (i === 3) { // Index 3 is the start/finish line
                                bot.lap++;
                                // console.log(`Bot ${botIndex} completed lap ${bot.lap}`);
                            }
                            
                            break; // Stop checking other checkpoints after a valid crossing
                        }
                    }
                }
            }

            // Store current position for next frame's checkpoint detection
            bot.prevPosition = bot.mesh.position.clone();

            // --- Basic Bot Item AI ---
            if (bot.item && bot.random() < botUseItemChance) {
                const playerIsCloseBehind = this.kart.position.distanceToSquared(bot.mesh.position) < 20*20 &&
                                         (new THREE.Vector3().subVectors(this.kart.position, bot.mesh.position)
                                             .dot(new THREE.Vector3(0,0,1).applyQuaternion(bot.mesh.quaternion)) < 0);
                const playerIsCloseAhead = this.kart.position.distanceToSquared(bot.mesh.position) < 25*25 &&
                                         (new THREE.Vector3().subVectors(this.kart.position, bot.mesh.position)
                                             .dot(new THREE.Vector3(0,0,1).applyQuaternion(bot.mesh.quaternion)) > 0);

                 if (bot.item === 'mushroom') {
                     if (Math.abs(angleDifference) < Math.PI / 8 && bot.mushroomBoostDuration <= 0) {
                         this.useItem(bot);
                     }
                 } else if (bot.item === 'banana' || bot.item === 'fakeItemBox') {
                     if (playerIsCloseBehind) { // Or other bots close behind
                         this.useItem(bot);
                     }
                 } else if (bot.item === 'greenShell') {
                     // Fire forward if player/bot ahead, backward if player/bot behind
                     // Simple: fire forward if someone generally in front.
                     if (playerIsCloseAhead || this.bots.some(otherBot => otherBot !== bot && bot.mesh.position.distanceToSquared(otherBot.mesh.position) < 25*25 && (new THREE.Vector3().subVectors(otherBot.mesh.position, bot.mesh.position).dot(new THREE.Vector3(0,0,1).applyQuaternion(bot.mesh.quaternion)) > 0) )) {
                         // this.useItem(bot) // fireDirection will be mostly forward by default in useGreenShell for bots
                         this.useItem(bot);
                     }
                 } else if (bot.item === 'redShell') {
                    // Bots use red shells if someone is ahead and not invisible
                    const botRankInfo = this.getBotRankAndRacers(bot); // bot is the bot object
                    let targetExistsAhead = false;
                    if (botRankInfo.rank > 1) { // If bot is not 1st
                        for (let i = botRankInfo.rank - 2; i >= 0; i--) { // Check racers ahead
                            if (!botRankInfo.sortedRacers[i].obj.isInvisible) {
                                targetExistsAhead = true;
                                break;
                            }
                        }
                    }
                    if (targetExistsAhead) {
                        this.useItem(bot); // useRedShell will find the specific target
                    }
                 } else if (bot.item === 'boo') {
                     // Use if somewhat behind or wants to steal an item
                     const botRank = this.bots.indexOf(bot) + 1; // Crude rank among bots
                     const playerRank = this.playerPosition;
                     if (botRank > (this.bots.length / 2) || (this.playerItem && bot.random() < 0.5)) { // If in latter half or player has item
                         this.useItem(bot);
                     }
                 } else if (bot.item === 'lightningBolt') {
                     // Use if significantly behind
                     const botRank = this.bots.indexOf(bot) + (this.playerPosition > this.bots.indexOf(bot) ? 0 : 1); // Very rough rank
                     if (botRank >= this.bots.length) { // If in last place or close to it
                         this.useItem(bot);
                     }
                 }
            }

        });
    }

    getBotRankAndRacers(botToRank) { // botToRank can be a bot object or null (if called for general player context)
        // Helper to get a racer's current rank and the sorted list of all racers
        const allRacersForRanking = [];
        // Player
        allRacersForRanking.push({ 
            id: 'player', 
            obj: { // This is the racer object structure Red Shell expects for its target
                mesh: this.kart, 
                lap: this.currentLap, 
                checkpointIndex: this.lastCheckpoint === -1 ? 3 : this.lastCheckpoint, 
                position: this.kart.position, 
                isPlayer: true, 
                isInvisible: this.playerIsInvisible,
                // For applyRedShellHit, ensure it can handle this structure or simplify what's passed
                // For now, applyRedShellHit will need to check isPlayer and access botRef if it's a bot.
                // Let's add botRef here for consistency, null for player.
                botRef: null 
            }
        });
        // Bots
        this.bots.forEach((bot, index) => {
            allRacersForRanking.push({ 
                id: `bot_${index}`, 
                obj: { // This is the racer object structure
                    mesh: bot.mesh, 
                    lap: bot.lap, 
                    checkpointIndex: bot.currentCheckpointIndex, 
                    position: bot.mesh.position, 
                    isPlayer: false, 
                    isInvisible: bot.isInvisible,
                    botRef: bot // Reference to the full bot object
                }
            });
        });

        allRacersForRanking.sort((a, b) => {
            if (a.obj.lap !== b.obj.lap) return b.obj.lap - a.obj.lap;
            const idxA = a.obj.checkpointIndex;
            const idxB = b.obj.checkpointIndex;
            // Corrected logic: Higher checkpoint index means further along *within the same lap*.
            // Checkpoint 3 is start/finish. If someone is at cp 0 and another at cp 3 of *same lap*,
            // cp 0 is further. If cp idxA = 0, idxB = 3, b is "behind" in terms of index but just finished lap.
            // This sorting is for current race progress.
            if (idxA !== idxB) return idxB - idxA; // Higher checkpoint index means they are "more ahead" on the current lap path.
                                                 // This assumes checkpoints are ordered 0, 1, 2, 3 along the track.

            const nextCheckpointIndexA = (a.obj.checkpointIndex + 1) % this.totalCheckpoints;
            const nextCheckpointIndexB = (b.obj.checkpointIndex + 1) % this.totalCheckpoints;
            const distA = this.calculateDistanceToNextCheckpoint(a.obj.position, nextCheckpointIndexA);
            const distB = this.calculateDistanceToNextCheckpoint(b.obj.position, nextCheckpointIndexB);
            return distA - distB; // Closer to next checkpoint is better
        });
        
        let rank = -1, firerObj = null;
        if (botToRank) { // If ranking a specific bot
            const botIdToFind = `bot_${this.bots.indexOf(botToRank)}`;
            const foundIndex = allRacersForRanking.findIndex(r => r.id === botIdToFind);
            if (foundIndex !== -1) {
                rank = foundIndex + 1; // 1-based rank
                firerObj = allRacersForRanking[foundIndex].obj;
            }
        } else { // If called generally (e.g. for player context in useRedShell)
            // rank and firerObj will be determined by the caller based on player's id.
        }


        return { rank: rank, sortedRacers: allRacersForRanking, firerObj: firerObj };
    }


    animate() {
        // Keep requesting frames regardless of state to allow rendering during countdown
        requestAnimationFrame(() => this.animate());

        this.frameCount++; // Increment frame counter

        const deltaTime = 1 / 60; // Placeholder: Ideally calculate actual time delta

        // Only run game logic if racing
        if (this.gameState === 'racing') {
            this.updateItemBoxes(deltaTime); // Update item box respawn timers
            this.updateKart(deltaTime); // Pass deltaTime to updateKart
            this.updateBots(deltaTime);
            this.checkKartCollisions();
            this.checkItemBoxCollisions(); 
            this.checkBananaCollisions(); 
            this.updateGreenShells(deltaTime);
            this.updateRedShells(deltaTime); // Update and check red shell collisions
            this.checkFakeItemBoxCollisions();
            this.checkCheckpoints();
            this.updateScoreboard();
            this.updateDriftSparks(deltaTime);
        } else if (this.gameState === 'countdown') {
            // Keep camera updated during countdown
            this.updateCamera();
        }

        // Always render the scene
        this.renderer.render(this.scene, this.camera);
    }


    updateGreenShells(deltaTime) {
        const shellRadius = 0.6; // Matches shell geometry radius

        for (let i = this.activeGreenShells.length - 1; i >= 0; i--) {
            const shell = this.activeGreenShells[i];
            const prevPos = shell.mesh.position.clone();
            const moveAmountVec = shell.velocity.clone(); // Velocity is units per frame
            const moveDistance = moveAmountVec.length();

            shell.lifetime -= deltaTime; // Decrement lifetime regardless of movement

            if (moveDistance > 0) {
                const moveDirection = moveAmountVec.clone().normalize();
                this.raycaster.set(prevPos, moveDirection);
                // Raycast just far enough to detect collision for the sphere's surface this frame
                this.raycaster.far = moveDistance + shellRadius; 

                const intersects = this.raycaster.intersectObjects(this.wallMeshes);
                let collisionOccurredThisFrame = false;

                if (intersects.length > 0) {
                    const collision = intersects[0];
                    // Check if the collision point (for the sphere's surface) is within this frame's travel
                    if (collision.distance - shellRadius < moveDistance) {
                        collisionOccurredThisFrame = true;
                        
                        // Position shell at the point of impact
                        shell.mesh.position.copy(collision.point);
                        
                        const worldNormal = collision.face.normal.clone();
                        worldNormal.transformDirection(collision.object.matrixWorld); // Transform normal to world space
                        
                        // Reflect velocity
                        shell.velocity.reflect(worldNormal);
                        
                        // Move shell slightly away from wall along the normal to prevent sinking
                        shell.mesh.position.addScaledVector(worldNormal, 0.01); 

                        shell.bouncesLeft--;
                    }
                }

                if (!collisionOccurredThisFrame) {
                    // No collision, move normally
                    shell.mesh.position.add(moveAmountVec);
                }
            }

            if (shell.lifetime <= 0 || shell.bouncesLeft < 0) {
                this.scene.remove(shell.mesh);
                shell.mesh.geometry.dispose(); // Dispose geometry
                // If material is shared, don't dispose, otherwise shell.mesh.material.dispose();
                this.activeGreenShells.splice(i, 1);
                continue;
            }

            // Check collision with player
            if (shell.owner.mesh !== this.kart && !this.playerIsInvisible) {
                if (shell.mesh.position.distanceTo(this.kart.position) < 1.0) { // 0.6 shell radius + 0.5 kart approx
                    this.applyGreenShellHit({ mesh: this.kart });
                    this.scene.remove(shell.mesh);
                    this.activeGreenShells.splice(i, 1);
                    continue;
                }
            }

            // Check collision with bots
            for (let j = 0; j < this.bots.length; j++) {
                const bot = this.bots[j];
                if (shell.owner !== bot && !bot.isInvisible) { // Can't hit self or invisible bot
                    if (shell.mesh.position.distanceTo(bot.mesh.position) < 1.0) {
                        this.applyGreenShellHit(bot);
                        this.scene.remove(shell.mesh);
                        this.activeGreenShells.splice(i, 1);
                        break; // Shell is gone
                    }
                }
            }
        }
    }

    checkFakeItemBoxCollisions() {
        const playerPos = this.kart.position;
        const kartRadius = 0.6;

        for (let i = this.droppedFakeItemBoxes.length - 1; i >= 0; i--) {
            const fakeBox = this.droppedFakeItemBoxes[i];
            const boxPos = fakeBox.mesh.position;

            if (!this.playerIsInvisible && playerPos.distanceTo(boxPos) < kartRadius + 0.9) { // 0.9 fake box radius
                this.applyFakeItemBoxHit({ mesh: this.kart });
                this.scene.remove(fakeBox.mesh);
                this.droppedFakeItemBoxes.splice(i, 1);
                continue;
            }

            for (let j = 0; j < this.bots.length; j++) {
                 const bot = this.bots[j];
                 if (!bot.isInvisible && bot.mesh.position.distanceTo(boxPos) < kartRadius + 0.9) {
                     this.applyFakeItemBoxHit(bot);
                     this.scene.remove(fakeBox.mesh);
                     this.droppedFakeItemBoxes.splice(i, 1);
                     break; 
                 }
            }
        }
    }

    handleWallCollisions(racer, intendedMovement, radius) {
        if (intendedMovement.lengthSq() === 0) {
            return false; // Not moving, no collision
        }

        const origin = racer.mesh.position.clone();
        const direction = intendedMovement.clone().normalize();

        this.raycaster.set(origin, direction);
        // Check slightly further than the movement + radius to catch collisions robustly
        this.raycaster.far = intendedMovement.length() + radius * 1.1; 

        const intersects = this.raycaster.intersectObjects(this.wallMeshes, false);

        if (intersects.length > 0) {
            const collision = intersects[0];

            // Check if the actual collision point of the sphere's surface is within this frame's travel
            if (collision.distance - radius < intendedMovement.length()) {
                // Collision will occur
                const worldNormal = collision.face.normal.clone().transformDirection(collision.object.matrixWorld).normalize();

                // 1. Adjust position to be just before impact
                // Move along the original direction up to the collision point (minus radius and a small epsilon)
                const distanceToImpactSurface = Math.max(0, collision.distance - radius - 0.01);
                racer.mesh.position.copy(origin).addScaledVector(direction, distanceToImpactSurface);

                // 2. Get current velocity vector
                let currentSpeed = racer.isPlayer ? racer.speedRef.get() : racer.speed;
                let currentRotationY = racer.isPlayer ? racer.rotationYRef.get() : racer.mesh.rotation.y;
                
                const velocity = new THREE.Vector3(Math.sin(currentRotationY), 0, Math.cos(currentRotationY)).multiplyScalar(currentSpeed);

                // 3. Reflect velocity
                velocity.reflect(worldNormal);

                // 4. Update racer's speed and orientation, and dampen speed
                const DAMPENING_FACTOR = 0.4; // How much speed is lost on impact
                const newSpeed = velocity.length() * DAMPENING_FACTOR;
                const newRotationY = Math.atan2(velocity.x, velocity.z);

                if (racer.isPlayer) {
                    racer.speedRef.set(newSpeed);
                    racer.rotationYRef.set(newRotationY);
                } else { // Bot
                    racer.speed = newSpeed;
                    racer.mesh.rotation.y = newRotationY;
                }
                
                // Optional: Apply a small impulse directly away from the wall to prevent sticking
                // racer.impulse.add(worldNormal.multiplyScalar(0.05));


                return true; // Collision occurred and was handled
            }
        }
        return false; // No collision
    }
}

// --- Difficulty Selection and Game Start Logic ---
document.addEventListener('DOMContentLoaded', () => {
    const difficultyScreen = document.getElementById('difficulty-selection');
    const gameContainer = document.getElementById('game-container');
    const speedometer = document.getElementById('speedometer');
    const raceInfo = document.querySelector('.race-info'); // Get the container
    const mobileControls = document.getElementById('mobile-controls');
    const driftButton = document.getElementById('drift-button'); 
    const rearViewButton = document.getElementById('rear-view-button'); 
    const difficultyButtons = document.querySelectorAll('#difficulty-selection .difficulty-button'); // Scope to difficulty
    const ccScreen = document.getElementById('cc-selection');
    const ccButtons = document.querySelectorAll('#cc-selection .cc-button'); // Scope to CC

    // Ensure race info is hidden initially if JS runs before CSS potentially
    if (raceInfo) raceInfo.classList.add('hidden');
    if (driftButton) driftButton.classList.add('hidden'); // Hide drift button initially
    if (rearViewButton) rearViewButton.classList.add('hidden'); 
    if (ccScreen) ccScreen.classList.add('hidden'); // Ensure CC screen hidden initially

    let selectedDifficulty = 'easy'; // Default difficulty

    difficultyButtons.forEach(button => {
        button.addEventListener('click', () => {
            selectedDifficulty = button.id.split('-')[0]; // 'easy', 'medium', or 'hard'

            // Hide difficulty screen, show CC screen
            difficultyScreen.classList.add('hidden');
            if (ccScreen) ccScreen.classList.remove('hidden');
        });
    });

    ccButtons.forEach(button => {
        button.addEventListener('click', () => {
            const selectedCC = button.id.split('-')[0]; // '50cc', '100cc', etc.

            // Hide CC screen
            if (ccScreen) ccScreen.classList.add('hidden');

            // Show game elements (except countdown initially)
            gameContainer.classList.remove('hidden');
            speedometer.classList.remove('hidden');
            const raceInfo = document.querySelector('.race-info');
            if (raceInfo) raceInfo.classList.remove('hidden');
            const itemDisplay = document.getElementById('item-display'); 
            if (itemDisplay) itemDisplay.classList.add('hidden'); // Start hidden
            const useItemButton = document.getElementById('use-item-button'); 
            if (useItemButton) useItemButton.classList.add('hidden'); // Start hidden
            const countdownDisplay = document.getElementById('countdown-display');
            if (countdownDisplay) countdownDisplay.classList.add('hidden'); 
            mobileControls.classList.remove('hidden');
            if (driftButton) driftButton.classList.remove('hidden'); 
            if (rearViewButton) rearViewButton.classList.remove('hidden'); 


            // Start the game with selected difficulty and CC
            new Game(selectedDifficulty, selectedCC);
        });
    });
});
