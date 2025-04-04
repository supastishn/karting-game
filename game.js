class Game {
    constructor(difficulty = 'easy') { // Accept difficulty
        this.difficulty = difficulty; // Store difficulty
        console.log(`Starting game with difficulty: ${this.difficulty}`);

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
            drift: false
        };
        this.speed = 0;
        this.maxSpeed = 0.5; // Decreased from 0.5
        this.acceleration = 0.0033; // Decreased from 0.01
        this.deceleration = 0.005;
        this.turnSpeed = 0.015;

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
        this.miniTurboThresholds = [0, 1.2, 2.0, 3.0]; // Time thresholds for each stage
        this.miniTurboBoostDurations = [0.8, 1.5, 2.5]; // Duration in seconds for each boost level
        this.boostMultiplier = 1.5; // Fixed boost multiplier for all levels
        this.boostTime = 0;
        this.maxBoostTime = 1.0;
        this.boosting = false;

        // Visual feedback
        this.sparkColors = ['#0099ff', '#ff6600', '#cc00ff'];
        this.sparkElement = document.createElement('div');
        this.sparkElement.className = 'spark-indicator';
        document.body.appendChild(this.sparkElement);

        // Speedometer element
        this.speedDisplay = document.querySelector('.speed-value');
        this.maxSpeedKmh = 180; // Maximum speed in km/h for display purposes

        // Prevent default touch behaviors
        document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
        document.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

        // Camera smoothing parameters
        this.cameraTargetPosition = new THREE.Vector3();
        this.cameraCurrentPosition = new THREE.Vector3();
        this.cameraLerpFactor = 0.1; // Adjust this value to change smoothing (0.01 to 0.1)
        this.lastKartPosition = new THREE.Vector3();
        this.cameraHeight = 5; // New parameter for camera height
        this.cameraDistance = -8; // New parameter for camera distance
        
        // Speed transition parameters
        this.currentSpeedLimit = this.maxSpeed;
        this.targetSpeedLimit = this.maxSpeed;
        this.speedLimitLerpFactor = 0.03; // Adjusted for 1-second transition (approximately 1/60)

        // Track parameters
        this.trackLength = 130;
        this.trackWidth = 130;   // Keep outer width the same
        this.trackLengthInner = 60;
        this.trackWidthInner = 30;   // Decreased from 100 to 30

        // Drift momentum parameters
        this.driftDirection = 0; // 1 for left, -1 for right
        this.driftMomentumTurnSpeed = 0.005;
        this.defaultDriftMomentumTurnSpeed = 0.005; // Store default value
        this.oppositeDirectionFactor = 0.001; // How much opposite direction reduces momentum (lower = more reduction)
        this.isInDriftMomentum = false;
        this.offRoadMultiplier = 0.3; // Speed multiplier when off-road

        // Lap counting system
        this.currentLap = 1;
        this.maxLaps = 3;
        this.checkpointsPassed = 0;
        this.totalCheckpoints = 4; // We'll divide track into 4 sectors
        this.lastCheckpoint = -1;
        this.checkpoints = []; // Will store checkpoint coordinates
        this.raceFinished = false;
        this.bots = []; // Array to hold bot objects
        
        // Lap display element - moved up in constructor for immediate visibility
        this.lapDisplay = document.createElement('div');
        this.lapDisplay.className = 'lap-counter';
        document.body.appendChild(this.lapDisplay);
        this.updateLapCounter(); // Call immediately to show initial lap count
        
        this.setupScene();
        this.createBots(3); // Create 3 bots
        this.setupControls();
        this.animate();
    }

    setupScene() {
        // Create larger ground
        const groundGeometry = new THREE.PlaneGeometry(400, 400);
        const groundMaterial = new THREE.MeshBasicMaterial({ color: 0x00aa00, side: THREE.DoubleSide });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = Math.PI / 2;
        this.scene.add(this.ground);

        // Create race track
        this.createRaceTrack();

        // Create kart (simple box) in purple
        const kartGeometry = new THREE.BoxGeometry(1, 0.5, 2);
        const kartMaterial = new THREE.MeshBasicMaterial({ color: 0x800080 });
        this.kart = new THREE.Mesh(kartGeometry, kartMaterial);
        this.scene.add(this.kart);

        // Define start parameters based on the first checkpoint definition
        const startParams = { x: 0, z: this.trackWidth / 4, rotation: Math.PI / 2 };
        const startOffsetDistance = 3.0; // How far behind the line to start

        // Calculate the direction vector opposite to the starting rotation
        const behindVector = new THREE.Vector3(
            -Math.sin(startParams.rotation),
            0,
            -Math.cos(startParams.rotation)
        );

        // Calculate the final starting position
        const finalStartPosition = new THREE.Vector3(
            startParams.x + behindVector.x * startOffsetDistance,
            0.25, // Kart height
            startParams.z + behindVector.z * startOffsetDistance
        );

        // Position kart slightly behind the start/finish line
        this.kart.position.copy(finalStartPosition);
        this.kart.rotation.y = startParams.rotation;

        // Position camera initially behind the kart
        this.updateCamera(); // Call updateCamera once to set initial position based on kart
        this.camera.position.copy(this.cameraTargetPosition); // Set camera position directly without lerp for the first frame
        this.camera.lookAt(this.kart.position);
    }

    createBots(numberOfBots) {
        const botGeometry = new THREE.BoxGeometry(1, 0.5, 2);
        const botColors = [0xff0000, 0x00ff00, 0x0000ff]; // Red, Green, Blue for bots
        const startOffset = 5.0; // How far behind the line bots start
        const spacing = 2.0; // Spacing between bots

        // Use the same starting parameters as the player kart for reference
        const startParams = { x: 0, z: this.trackWidth / 4, rotation: Math.PI / 2 };
        const behindVector = new THREE.Vector3(
            -Math.sin(startParams.rotation), 0, -Math.cos(startParams.rotation)
        );
        const sideVector = new THREE.Vector3(
            Math.cos(startParams.rotation), 0, -Math.sin(startParams.rotation)
        );

        for (let i = 0; i < numberOfBots; i++) {
            const botMaterial = new THREE.MeshBasicMaterial({ color: botColors[i % botColors.length] });
            const botMesh = new THREE.Mesh(botGeometry, botMaterial);

            // Calculate staggered starting position
            const botStartPosition = new THREE.Vector3(startParams.x, 0.25, startParams.z)
                .addScaledVector(behindVector, startOffset + i * 1.5) // Stagger depth
                .addScaledVector(sideVector, (i % 2 === 0 ? 1 : -1) * spacing * Math.ceil((i+1)/2)); // Stagger side

            botMesh.position.copy(botStartPosition);
            botMesh.rotation.y = startParams.rotation; // Start facing forward

            this.scene.add(botMesh);

            // Assign unique stats to each bot based on difficulty
            let botStats = {};
            switch (this.difficulty) {
                case 'medium':
                    botStats = {
                        maxSpeed: this.maxSpeed * (0.75 + Math.random() * 0.2), // 75-95%
                        acceleration: this.acceleration * (0.9 + Math.random() * 0.4),
                        turnRate: this.turnSpeed * (1.8 + Math.random() * 1.0), // 1.8x - 2.8x
                        targetOffset: (Math.random() - 0.5) * 10 // +/- 5.0
                    };
                    break;
                case 'hard':
                    botStats = {
                        maxSpeed: this.maxSpeed * (0.85 + Math.random() * 0.2), // 85-105%
                        acceleration: this.acceleration * (1.0 + Math.random() * 0.4),
                        turnRate: this.turnSpeed * (2.2 + Math.random() * 1.0), // 2.2x - 3.2x
                        targetOffset: (Math.random() - 0.5) * 5 // +/- 2.5
                    };
                    break;
                case 'easy':
                default: // Default to easy
                    botStats = {
                        maxSpeed: this.maxSpeed * (0.65 + Math.random() * 0.2), // 65-85%
                        acceleration: this.acceleration * (0.8 + Math.random() * 0.4),
                        turnRate: this.turnSpeed * (1.5 + Math.random() * 1.0), // 1.5x - 2.5x
                        targetOffset: (Math.random() - 0.5) * 15 // +/- 7.5
                    };
                    break;
            }


            this.bots.push({
                mesh: botMesh,
                speed: 0, // Start stationary
                targetCheckpointIndex: 1,
                currentCheckpointIndex: 0,
                stats: botStats // Store the unique stats
            });
        }
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

        // Create checkpoint positions (4 points around the track)
        const checkpointPositions = [
            { x: 0, z: this.trackWidth /4, rotation: Math.PI/2, color: 0xff0000, number: "1" }, // Start/Finish line (red)
            { x: this.trackLength / 3, z: 0, rotation: Math.PI, color: 0x00ff00, number: "2" }, // Checkpoint 1 (green)
            { x: 0, z: -this.trackWidth / 4, rotation: -Math.PI/2, color: 0x0000ff, number: "3" }, // Checkpoint 2 (blue)
            { x: -this.trackLength / 3, z: 0, rotation: 0, color: 0xffff00, number: "4" } // Checkpoint 3 (yellow)
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

    setupControls() {
        // Keyboard controls
        window.addEventListener('keydown', (e) => {
            const wasPressed = this.keys[e.key.toLowerCase()];
            this.keys[e.key.toLowerCase()] = true;
            if (e.key === ' ' && !wasPressed) {
                this.touchControls.drift = true;
                this.handleDriftPress();
            }
        });
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
            if (e.key === ' ') {
                this.touchControls.drift = false;
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

    updateSpeedometer() {
        // Convert speed to km/h (speed is currently in arbitrary units)
        const speedKmh = Math.abs(this.speed) * (this.maxSpeedKmh / this.maxSpeed);
        this.speedDisplay.textContent = Math.round(speedKmh);
    }

    updateCamera() {
        // Calculate ideal camera position
        const cameraOffset = new THREE.Vector3(0, this.cameraHeight, this.cameraDistance);
        cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.kart.rotation.y);
        this.cameraTargetPosition.copy(this.kart.position).add(cameraOffset);

        // Smooth camera position using lerp
        this.camera.position.lerp(this.cameraTargetPosition, this.cameraLerpFactor);

        // Calculate look-at position with slight prediction based on movement
        const kartVelocity = new THREE.Vector3().copy(this.kart.position).sub(this.lastKartPosition);
        const lookAtPosition = new THREE.Vector3().copy(this.kart.position).add(kartVelocity.multiplyScalar(2));
        this.camera.lookAt(lookAtPosition);
    }

    updateKart() {
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
            this.driftTime += (1 / 60) * chargeRate; // Assuming 60fps

            // Update mini-turbo stage based on drift time
            for (let i = this.miniTurboThresholds.length - 1; i >= 0; i--) {
                if (this.driftTime >= this.miniTurboThresholds[i]) {
                    this.miniTurboStage = i;
                    break;
                }
            }

            // Update visual feedback
            if (this.miniTurboStage > 0) {
                this.sparkElement.style.display = 'block';
                this.sparkElement.style.backgroundColor = this.sparkColors[this.miniTurboStage - 1];
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
            this.sparkElement.style.display = 'none';
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
        if (this.boosting) {
            this.targetSpeedLimit *= this.boostMultiplier;
        }

        // Apply off-road penalty
        if (this.isOffRoad(this.kart.position)) {
            this.targetSpeedLimit *= this.offRoadMultiplier;
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
        this.kart.position.add(movement);

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
                    // Log checkpoint entry
                    console.log(`%cCrossed Checkpoint ${i + 1} Plane!`, 'background: #4CAF50; color: white; padding: 4px; border-radius: 4px;');
                    console.debug({
                        checkpoint: i + 1,
                        kartPosition: {
                        x: this.kart.position.x.toFixed(2),
                        y: this.kart.position.y.toFixed(2),
                        z: this.kart.position.z.toFixed(2)
                    },
                    leftPost: {
                        x: leftPost.x.toFixed(2),
                        z: leftPost.z.toFixed(2)
                    },
                    rightPost: {
                        x: rightPost.x.toFixed(2),
                        z: rightPost.z.toFixed(2)
                    },
                    intersectionPoint: {
                        x: intersectionPoint.x.toFixed(2),
                        z: intersectionPoint.z.toFixed(2)
                    },
                    distanceAlongGate: distanceAlongGate.toFixed(2),
                    checkpointWidth: checkpointWidth.toFixed(2)
                });

                // Check if this is the next expected checkpoint
                if (i === (this.lastCheckpoint + 1) % this.totalCheckpoints) {
                    this.lastCheckpoint = i;
                    console.log(`%cValid checkpoint sequence! Checkpoint ${i + 1} registered`, 'background: #2196F3; color: white; padding: 4px; border-radius: 4px;');
                    
                    // If we crossed the start/finish line (checkpoint 0)
                    if (i === 0 && this.checkpointsPassed >= this.totalCheckpoints - 1) {
                        this.currentLap++;
                        this.checkpointsPassed = 0;
                        console.log(`%cLap ${this.currentLap} started!`, 'background: #9C27B0; color: white; padding: 4px; border-radius: 4px;');
                        this.updateLapCounter();
                        
                        // Check if race is finished
                        if (this.currentLap > this.maxLaps) {
                            this.raceFinished = true;
                            console.log('%cRace Complete!', 'background: #FFC107; color: black; padding: 4px; border-radius: 4px;');
                            alert('Race Complete!');
                        }
                    } else {
                        this.checkpointsPassed++;
                        console.debug(`Checkpoints passed this lap: ${this.checkpointsPassed}/${this.totalCheckpoints}`);
                    }
                } else {
                    console.warn(`Wrong checkpoint sequence! Expected ${(this.lastCheckpoint + 1) % this.totalCheckpoints + 1}, got ${i + 1}`);
                }
                break;
            }
        }
    }
    }

    updateBots() {
        const arrivalThreshold = 3.0; // How close the bot needs to be to the *actual* checkpoint center
        const lookAheadDistance = 10.0; // How far ahead the bot looks for steering

        this.bots.forEach(bot => {
            if (!this.checkpoints || this.checkpoints.length < 2) return; // Need at least 2 checkpoints

            const currentCheckpointIndex = bot.currentCheckpointIndex;
            const targetCheckpointIndex = bot.targetCheckpointIndex;
            const nextTargetCheckpointIndex = (targetCheckpointIndex + 1) % this.totalCheckpoints;

            const currentCheckpoint = this.checkpoints[currentCheckpointIndex];
            const targetCheckpoint = this.checkpoints[targetCheckpointIndex];
            const nextTargetCheckpoint = this.checkpoints[nextTargetCheckpointIndex];

            if (!targetCheckpoint || !nextTargetCheckpoint) return; // Ensure targets exist

            // --- Target Calculation for Curved Path ---
            // 1. Vector from current bot position to target checkpoint center
            const vecToTargetCenter = targetCheckpoint.position.clone().sub(bot.mesh.position);
            vecToTargetCenter.y = 0; // Ignore height difference for pathing
            const distanceToTargetCenter = vecToTargetCenter.length();

            // 2. Vector representing the direction from target to the *next* target (approximates exit direction)
            const targetExitDirection = nextTargetCheckpoint.position.clone().sub(targetCheckpoint.position);
            targetExitDirection.y = 0;
            targetExitDirection.normalize();

            // 3. Calculate a sideways offset vector (perpendicular to exit direction)
            const sidewaysOffsetVector = new THREE.Vector3(targetExitDirection.z, 0, -targetExitDirection.x);

            // 4. Calculate the actual target point with the bot's offset
            const offsetTargetPosition = targetCheckpoint.position.clone()
                .addScaledVector(sidewaysOffsetVector, bot.stats.targetOffset);
            offsetTargetPosition.y = bot.mesh.position.y; // Keep target at bot's height

            // --- Steering ---
            // Calculate vector towards the offset target point
            const directionToOffsetTarget = offsetTargetPosition.clone().sub(bot.mesh.position);
            directionToOffsetTarget.y = 0;
            directionToOffsetTarget.normalize();

            // Calculate desired angle
            const desiredAngle = Math.atan2(directionToOffsetTarget.x, directionToOffsetTarget.z);

            // Smoothly interpolate current angle towards desired angle
            let angleDifference = desiredAngle - bot.mesh.rotation.y;
            // Normalize angle difference to [-PI, PI]
            while (angleDifference < -Math.PI) angleDifference += Math.PI * 2;
            while (angleDifference > Math.PI) angleDifference -= Math.PI * 2;

            // Apply turn rate, clamping the change
            const turnAmount = Math.max(-bot.stats.turnRate, Math.min(bot.stats.turnRate, angleDifference));
            bot.mesh.rotation.y += turnAmount;

            // --- Speed and Movement ---
            // Reduce max speed based on the sharpness of the required turn
            let currentMaxSpeed = bot.stats.maxSpeed;
            // Calculate how much the bot needs to turn (0 = straight, 1 = 90 degrees or more)
            const turnSharpnessFactor = Math.min(1.0, Math.abs(angleDifference) / (Math.PI / 2));
            // Reduce speed more for sharper turns (e.g., up to 50% reduction for a 90+ degree turn)
            currentMaxSpeed *= (1.0 - turnSharpnessFactor * 0.5);

            // Accelerate towards (potentially reduced) max speed
            bot.speed = Math.min(currentMaxSpeed, bot.speed + bot.stats.acceleration);

            // Move bot forward based on its current rotation
            const moveDirection = new THREE.Vector3(
                Math.sin(bot.mesh.rotation.y),
                0,
                Math.cos(bot.mesh.rotation.y)
            );
            bot.mesh.position.addScaledVector(moveDirection, bot.speed);

            // --- Checkpoint Advancement ---
            // Check distance to the *actual* checkpoint center, not the offset one
            if (distanceToTargetCenter < arrivalThreshold) {
                bot.currentCheckpointIndex = targetCheckpointIndex;
                bot.targetCheckpointIndex = nextTargetCheckpointIndex;
                // console.log(`Bot reached checkpoint ${bot.currentCheckpointIndex + 1}, next target: ${bot.targetCheckpointIndex + 1}`);
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.updateKart();
        this.updateBots(); // Update bots each frame
        this.checkCheckpoints();
        this.renderer.render(this.scene, this.camera);
    }
}

// --- Difficulty Selection and Game Start Logic ---
document.addEventListener('DOMContentLoaded', () => {
    const difficultyScreen = document.getElementById('difficulty-selection');
    const gameContainer = document.getElementById('game-container');
    const speedometer = document.getElementById('speedometer');
    const lapCounter = document.querySelector('.lap-counter');
    const mobileControls = document.getElementById('mobile-controls');
    const difficultyButtons = document.querySelectorAll('.difficulty-button');

    difficultyButtons.forEach(button => {
        button.addEventListener('click', () => {
            const selectedDifficulty = button.id.split('-')[0]; // 'easy', 'medium', or 'hard'

            // Hide difficulty screen
            difficultyScreen.classList.add('hidden');

            // Show game elements
            gameContainer.classList.remove('hidden');
            speedometer.classList.remove('hidden');
            lapCounter.classList.remove('hidden');
            mobileControls.classList.remove('hidden');

            // Start the game with the selected difficulty
            new Game(selectedDifficulty);
        });
    });
});
