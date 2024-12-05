import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";

let camera, scene, renderer, controls, dog, landscape, streaks;

// Controllers
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let raycaster;
const intersected = [];
let group;

let marker, floor, baseReferenceSpace;
let INTERSECTION;
const tempMatrix = new THREE.Matrix4();

let lastInteractionTime = Date.now();
const resetCameraDelay = 2000; // 2 seconds

const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  ArrowUp: false,
  ArrowDown: false,
};

let speed = 0.1;
const minSpeed = 0.04;
const maxSpeed = 0.2;
const tiltAngle = 0.01;

init();

function init() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.25,
    1000
  );
  camera.position.set(0, 2, -5); // Position the camera behind the dog
  camera.lookAt(new THREE.Vector3(0, 2, 1)); // Look towards the positive Z-axis

  scene = new THREE.Scene();

  // Add basic lighting
  const ambientLight = new THREE.AmbientLight(0x404040); // soft white light
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(1, 1, 1).normalize();
  scene.add(directionalLight);

  // Initialize renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  // Add OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.update();

  // Add VRButton
  document.body.appendChild(VRButton.createButton(renderer));

  // Load and set the HDR skybox
  const rgbeLoader = new RGBELoader();
  rgbeLoader.load("images/qwantani_dusk_2_4k.hdr", function (texture) {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = texture;
    scene.environment = texture;
  });

  // Add Dog model
  const gltfLoader = new GLTFLoader();
  gltfLoader.load("models/Dog.glb", function (gltf) {
    dog = gltf.scene;
    dog.scale.set(0.5, 0.5, 0.5); // Adjust the scale as needed
    dog.position.set(0, 1, 0); // Adjust the initial position as needed
    dog.rotation.set(0, 0, 0); // Initial orientation
    scene.add(dog);
  });

  // Add Landscape model
  gltfLoader.load("models/World_poly.glb", function (gltf) {
    landscape = gltf.scene;
    landscape.scale.set(1, 1, 1); // Adjust the scale as needed
    landscape.position.set(0, 0, 0); // Adjust the initial position as needed
    scene.add(landscape);
  });

  // Controllers setup
  controller1 = renderer.xr.getController(0);
  controller1.addEventListener("selectstart", onSelectStart);
  controller1.addEventListener("selectend", onSelectEnd);
  scene.add(controller1); // Add controller1 to the scene

  controller2 = renderer.xr.getController(1);
  controller2.addEventListener("selectstart", onSelectStart);
  controller2.addEventListener("selectend", onSelectEnd);
  scene.add(controller2); // Add controller2 to the scene

  const controllerModelFactory = new XRControllerModelFactory();

  // Listen for user interactions with OrbitControls
  controls.addEventListener("start", () => {
    lastInteractionTime = Date.now();
  });

  // Create speedometer UI
  const speedometer = document.createElement("div");
  speedometer.id = "speedometer";
  speedometer.style.position = "absolute";
  speedometer.style.bottom = "10px";
  speedometer.style.left = "10px";
  speedometer.style.width = "200px";
  speedometer.style.height = "20px";
  speedometer.style.backgroundColor = "#ccc";
  document.body.appendChild(speedometer);

  const speedBar = document.createElement("div");
  speedBar.id = "speedBar";
  speedBar.style.height = "100%";
  speedBar.style.width = `${
    ((speed - minSpeed) / (maxSpeed - minSpeed)) * 100
  }%`;
  speedBar.style.backgroundColor = "#00f";
  speedometer.appendChild(speedBar);

  // Create streaks particle effect
  const particles = new THREE.BufferGeometry();
  const particleCount = 5000000;
  const positions = new Float32Array(particleCount * 3);
  const spread = 500; // Increase this value to spread particles over a wider area
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
    positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
  }
  particles.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  // Create a custom shader material for the particles
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      pointTexture: {
        value: new THREE.TextureLoader().load("images/white_texture.jpg"),
      },
      dogPosition: { value: new THREE.Vector3() },
      maxDistance: { value: 20.0 }, // Maximum distance for particles to be visible
    },
    vertexShader: `
    uniform vec3 dogPosition;
    uniform float maxDistance;
    varying float vAlpha;
    void main() {
      float distance = length(position - dogPosition);
      vAlpha = 1.0 - smoothstep(0.0, maxDistance, distance);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = 1.0; // Adjust this value to make particles larger
    }
  `,
    fragmentShader: `
    uniform sampler2D pointTexture;
    varying float vAlpha;
    void main() {
      gl_FragColor = texture2D(pointTexture, gl_PointCoord);
      gl_FragColor.a *= vAlpha;
    }
  `,
    transparent: true,
    blending: THREE.AdditiveBlending, // Ensure alpha blending is set up correctly
    depthWrite: false, // Disable depth writing for correct transparency
  });

  streaks = new THREE.Points(particles, particleMaterial);
  streaks.visible = false; // Initially hidden
  scene.add(streaks);

  // Animation loop
  animate();
}

document.addEventListener("keydown", function (event) {
  if (!dog) return;
  if (event.key in keys) {
    keys[event.key] = true;
  }
});

document.addEventListener("keyup", function (event) {
  if (event.key in keys) {
    keys[event.key] = false;
  }
});

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  if (dog) {
    // Move the dog forward in the direction it is facing
    dog.translateX(speed);

    // Define local axes
    const localXAxis = new THREE.Vector3(1, 0, 0);
    const localZAxis = new THREE.Vector3(0, 0, 1);

    // Update dog rotation based on key states
    if (keys.a) dog.rotateOnAxis(localXAxis, -tiltAngle);
    if (keys.d) dog.rotateOnAxis(localXAxis, tiltAngle);
    if (keys.s) dog.rotateOnAxis(localZAxis, tiltAngle);
    if (keys.w) dog.rotateOnAxis(localZAxis, -tiltAngle);

    // Update speed based on arrow key states
    if (keys.ArrowUp) speed = Math.min(speed + 0.0002, maxSpeed);
    if (keys.ArrowDown) speed = Math.max(speed - 0.0002, minSpeed);

    // Update speedometer
    const speedBar = document.getElementById("speedBar");
    speedBar.style.width = `${
      ((speed - minSpeed) / (maxSpeed - minSpeed)) * 100
    }%`;

    // Show or hide streaks based on speed
    streaks.visible = speed > 0.15;

    // Update particle shader with the Dog model's position
    streaks.material.uniforms.dogPosition.value.copy(dog.position);

    // Update camera position to follow the dog
    const relativeCameraOffset = new THREE.Vector3(-10, 3, 0);
    const cameraOffset = relativeCameraOffset.applyMatrix4(dog.matrixWorld);

    // Only reset the camera position if the user hasn't interacted for a specified duration
    if (Date.now() - lastInteractionTime > resetCameraDelay) {
      camera.position.lerp(cameraOffset, 0.1);
      camera.lookAt(dog.position);
    }

    // Update OrbitControls target to the dog's position
    controls.target.copy(dog.position);
  }

  controls.update();
  renderer.render(scene, camera);
}

function onSelectStart(event) {
  // Handle select start event
}

function onSelectEnd(event) {
  // Handle select end event
}
