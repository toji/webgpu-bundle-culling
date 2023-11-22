// This file contains the necessary structure for a minimalistic WebGPU demo app.
// It uses dat.gui to offer a basic options panel and stats.js to display performance.

import { vec3, mat4 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js';

import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.1/dist/tweakpane.min.js';

// Style for elements used by the demo.
const injectedStyle = document.createElement('style');
injectedStyle.innerText = `
  html, body {
    height: 100%;
    margin: 0;
    font-family: sans-serif;
  }

  body {
    height: 100%;
    background-color: #222222;
  }

  canvas {
    position: absolute;
    z-index: 0;
    height: 100%;
    width: 100%;
    inset: 0;
    margin: 0;
    touch-action: none;
  }

  .error {
    position: absolute;
    z-index: 2;
    inset: 9em 3em;
    margin: 0;
    padding: 0;
    color: #FF8888;
  }

  .tp-dfwv {
    z-index: 3;
    width: 290px !important;
  }
`;
document.head.appendChild(injectedStyle);

const FRAME_BUFFER_SIZE = Float32Array.BYTES_PER_ELEMENT * 64;
const mat = mat4.create();
const tmpVec3 = vec3.create();

export class TinyWebGpuDemo {
  #frameArrayBuffer = new ArrayBuffer(FRAME_BUFFER_SIZE);
  #projectionMatrix = new Float32Array(this.#frameArrayBuffer, 0, 16);
  #viewMatrix = new Float32Array(this.#frameArrayBuffer, 16 * Float32Array.BYTES_PER_ELEMENT, 16);
  #cameraPosition = new Float32Array(this.#frameArrayBuffer, 32 * Float32Array.BYTES_PER_ELEMENT, 3);
  #timeArray = new Float32Array(this.#frameArrayBuffer, 35 * Float32Array.BYTES_PER_ELEMENT, 1);
  #zRangeArray = new Float32Array(this.#frameArrayBuffer, 36 * Float32Array.BYTES_PER_ELEMENT, 2);
  #frustum = new Float32Array(this.#frameArrayBuffer, 40 * Float32Array.BYTES_PER_ELEMENT, 24);

  static CAMERA_UNIFORM_STRUCT = `
    struct CameraUniforms {
      projection: mat4x4f,
      view: mat4x4f,
      position: vec3f,
      time: f32,
      zRange: vec2f,
      frustum: array<vec4f, 6>
    }
  `;

  #fps = new Array(20);
  #fpsIndex = 0;

  #frameJsMs = new Array(20);
  #frameJsMsIndex = 0;

  #frameGpuMs = new Array(20);
  #frameGpuMsIndex = 0;

  // Configurable by extending classes
  colorFormat = navigator.gpu?.getPreferredCanvasFormat?.() || 'bgra8unorm';
  depthFormat = 'depth24plus';
  sampleCount = 4;
  clearColor = {r: 0, g: 0, b: 0, a: 1.0};
  fov = Math.PI * 0.5;
  zNear = 0.01;
  zFar = 128;
  #canvasResolution = { width: 1, height: 1 };
  #resolutionScale = 1;

  constructor() {
    this.canvas = document.querySelector('.webgpu-canvas');

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      document.body.appendChild(this.canvas);
    }
    this.context = this.canvas.getContext('webgpu');

    this.pane = new Pane({
      title: document.title.split('|')[0],
    });

    this.camera = new OrbitCamera(this.canvas);

    this.resizeObserver = new ResizeObserverHelper(this.canvas, (width, height) => {
      if (width == 0 || height == 0) { return; }
      this.#canvasResolution = { width, height };
      this.#updateResolution();
    });

    let lastFrameTime;

    const frameCallback = (t) => {
      requestAnimationFrame(frameCallback);

      const frameStart = performance.now();

      // Update the frame uniforms
      this.#viewMatrix.set(this.camera.viewMatrix);
      this.#cameraPosition.set(this.camera.position);
      this.#timeArray[0] = t;

      this.buildFrustum(this.#projectionMatrix, this.camera.viewMatrix, this.#frustum);

      this.device.queue.writeBuffer(this.frameUniformBuffer, 0, this.#frameArrayBuffer);

      this.onFrame(this.device, this.context, t);

      this.#frameJsMs[this.#frameJsMsIndex++ % this.#frameJsMs.length] = performance.now() - frameStart;

      const frameTime = performance.now();
      this.#fps[this.#fpsIndex++ % this.#fps.length] = frameTime - lastFrameTime;
      lastFrameTime = frameTime;
    };

    this.#initWebGPU().then(() => {
      // Make sure the resize callback has a chance to fire at least once now that the device is
      // initialized.
      this.resizeObserver.callback(this.canvas.width, this.canvas.height);
      // Start the render loop.
      lastFrameTime = performance.now();
      requestAnimationFrame(frameCallback);
    }).catch((error) => {
      // If something goes wrong during initialization, put up a really simple error message.
      this.setError(error, 'initializing WebGPU');
      throw error;
    });
  }

  buildFrustum(projection, view, frustum) {
    mat4.mul(mat, projection, view);

    // Left clipping plane
    vec3.set(tmpVec3, mat[3] + mat[0], mat[7] + mat[4], mat[11] + mat[8]);
    let l = vec3.length(tmpVec3);
    frustum[0] = tmpVec3[0] / l;
    frustum[1] = tmpVec3[1] / l;
    frustum[2] = tmpVec3[2] / l;
    frustum[3] = (mat[15] + mat[12]) / l;
    // Right clipping plane
    vec3.set(tmpVec3, mat[3] - mat[0], mat[7] - mat[4], mat[11] - mat[8]);
    l = vec3.length(tmpVec3);
    frustum[4] = tmpVec3[0] / l;
    frustum[5] = tmpVec3[1] / l;
    frustum[6] = tmpVec3[2] / l;
    frustum[7] = (mat[15] - mat[12]) / l;
    // Top clipping plane
    vec3.set(tmpVec3, mat[3] - mat[1], mat[7] - mat[5], mat[11] - mat[9]);
    l = vec3.length(tmpVec3);
    frustum[8] = tmpVec3[0] / l;
    frustum[9] = tmpVec3[1] / l;
    frustum[10] = tmpVec3[2] / l;
    frustum[11] = (mat[15] - mat[13]) / l;
    // Bottom clipping plane
    vec3.set(tmpVec3, mat[3] + mat[1], mat[7] + mat[5], mat[11] + mat[9]);
    l = vec3.length(tmpVec3);
    frustum[12] = tmpVec3[0] / l;
    frustum[13] = tmpVec3[1] / l;
    frustum[14] = tmpVec3[2] / l;
    frustum[15] = (mat[15] + mat[13]) / l;
    // Near clipping plane
    vec3.set(tmpVec3, mat[2], mat[6], mat[10]);
    l = vec3.length(tmpVec3);
    frustum[16] = tmpVec3[0] / l;
    frustum[17] = tmpVec3[1] / l;
    frustum[18] = tmpVec3[2] / l;
    frustum[19] = mat[14] / l;
    // Far clipping plane
    vec3.set(tmpVec3, mat[3] - mat[2], mat[7] - mat[6], mat[11] - mat[10]);
    l = vec3.length(tmpVec3);
    frustum[20] = tmpVec3[0] / l;
    frustum[21] = tmpVec3[1] / l;
    frustum[22] = tmpVec3[2] / l;
    frustum[23] = (mat[15] - mat[14]) / l;
  }

  setError(error, contextString) {
    let prevError = document.querySelector('.error');
    while (prevError) {
      this.canvas.parentElement.removeChild(document.querySelector('.error'));
      prevError = document.querySelector('.error');
    }

    if (error) {
      const errorElement = document.createElement('p');
      errorElement.classList.add('error');
      errorElement.innerHTML = `
        <p style='font-weight: bold'>An error occured${contextString ? ' while ' + contextString : ''}:</p>
        <pre>${error?.message ? error.message : error}</pre>`;
        this.canvas.parentElement.appendChild(errorElement);
    }
  }

  #updateResolution() {
    this.canvas.width = this.#canvasResolution.width * this.#resolutionScale;
    this.canvas.height = this.#canvasResolution.height * this.#resolutionScale;

    this.updateProjection(this.canvas.width, this.canvas.height);

    if (this.device) {
      const size = {width: this.canvas.width, height: this.canvas.height};
      this.#allocateRenderTargets(size);
      this.onResize(this.device, size);
    }
  }

  updateProjection(width, height) {
    const aspect = width / height;
    // Using mat4.perspectiveZO instead of mat4.perpective because WebGPU's
    // normalized device coordinates Z range is [0, 1], instead of WebGL's [-1, 1]
    mat4.perspectiveZO(this.#projectionMatrix, this.fov, aspect, this.zNear, this.zFar);
    this.#zRangeArray[0] = this.zNear;
    this.#zRangeArray[1] = this.zFar;
  }

  get resolutionScale() {
    return this.#resolutionScale;
  }

  set resolutionScale(value) {
    if (this.#resolutionScale != value) {
      this.#resolutionScale = value;
      this.#updateResolution();
    }
  }

  get fps() {
    let avg = 0;
    for (const value of this.#fps) {
      if (value === undefined) { return 0; } // Don't have enough samples yet
      avg += value;
    }
    return 1000 / (avg / this.#fps.length);
  }

  get frameJsMs() {
    let avg = 0;
    for (const value of this.#frameJsMs) {
      if (value === undefined) { return 0; } // Don't have enough samples yet
      avg += value;
    }
    return avg / this.#frameJsMs.length;
  }

  get frameGpuMs() {
    let avg = 0;
    for (const value of this.#frameGpuMs) {
      if (value === undefined) { return 0; } // Don't have enough samples yet
      avg += value;
    }
    return avg / this.#frameGpuMs.length;
  }

  get frameArrayBuffer() {
    return this.#frameArrayBuffer.slice();
  }

  async #initWebGPU() {
    const adapter = await navigator.gpu.requestAdapter();

    const requiredFeatures = [];
    const featureList = adapter.features;
    if (featureList.has('texture-compression-bc')) {
      requiredFeatures.push('texture-compression-bc');
    }
    if (featureList.has('texture-compression-etc2')) {
      requiredFeatures.push('texture-compression-etc2');
    }
    if (featureList.has('timestamp-query')) {
      requiredFeatures.push('timestamp-query');
    }

    this.device = await adapter.requestDevice({
      requiredFeatures,
    });
    this.context.configure({
      device: this.device,
      format: this.colorFormat,
      alphaMode: 'opaque',
    });

    this.frameUniformBuffer = this.device.createBuffer({
      size: FRAME_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.frameBindGroupLayout = this.device.createBindGroupLayout({
      label: `Frame BindGroupLayout`,
      entries: [{
        binding: 0, // Camera/Frame uniforms
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
        buffer: {},
      }],
    });

    this.frameBindGroup = this.device.createBindGroup({
      label: `Frame BindGroup`,
      layout: this.frameBindGroupLayout,
      entries: [{
        binding: 0, // Camera uniforms
        resource: { buffer: this.frameUniformBuffer },
      }],
    });

    this.pane.addBinding(this, 'fps', {
      label: 'FPS',
      readonly: true,
    });
    this.statsFolder = this.pane.addFolder({
      title: 'More Stats',
      expanded: false,
    });
    this.statsFolder.addBinding(this, 'frameJsMs', {
      label: 'Frame JS ms',
      readonly: true,
      view: 'graph',
      //min: 0,
      //max: 32
    });
    this.statsFolder.addBinding(this, 'frameJsMs', {
      label: '',
      readonly: true,
    });

    await this.onInit(this.device);
  }

  #allocateRenderTargets(size) {
    if (this.msaaColorTexture) {
      this.msaaColorTexture.destroy();
    }

    if (this.sampleCount > 1) {
      this.msaaColorTexture = this.device.createTexture({
        size,
        sampleCount: this.sampleCount,
        format: this.colorFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }

    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      size,
      sampleCount: this.sampleCount,
      format: this.depthFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.colorAttachment = {
      // Appropriate target will be populated in onFrame
      view: this.sampleCount > 1 ? this.msaaColorTexture.createView() : undefined,
      resolveTarget: undefined,

      clearValue: this.clearColor,
      loadOp: 'clear',
      storeOp: this.sampleCount > 1 ? 'discard' : 'store',
    };

    let timestampWrites;
    if (this.timestampQuerySet) {
      timestampWrites = {
        querySet: this.timestampQuerySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1
      }
    }

    this.renderPassDescriptor = {
      colorAttachments: [this.colorAttachment],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
      timestampWrites
    };
  }

  async #readbackTimestampQuery() {
    let readbackBuffer;
    if (this.timestampReadbackBuffers.length > 0) {
      readbackBuffer = this.timestampReadbackBuffers.pop();
    } else {
      readbackBuffer = this.device.createBuffer({
        label: 'Timestamp Readback',
        size: this.timestampResolveBuffer.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    }

    // TODO: This should be part of the frame's command buffer, ideally
    const encoder = this.device.createCommandEncoder();
    encoder.resolveQuerySet(this.timestampQuerySet, 0, 2, this.timestampResolveBuffer, 0);
    encoder.copyBufferToBuffer(this.timestampResolveBuffer, 0, readbackBuffer, 0, this.timestampResolveBuffer.size);
    this.device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const mappedArray = new BigUint64Array(readbackBuffer.getMappedRange());

    const renderPassTime = Number(mappedArray[1] - mappedArray[0]);
    // Discard negative times
    if (renderPassTime >= 0) {
      this.#frameGpuMs[this.#frameGpuMsIndex++ % this.#frameGpuMs.length] = renderPassTime / 1000000;
    }

    readbackBuffer.unmap();
    this.timestampReadbackBuffers.push(readbackBuffer);
  }

  get defaultRenderPassDescriptor() {
    const colorTexture = this.context.getCurrentTexture().createView();
    if (this.sampleCount > 1) {
      this.colorAttachment.resolveTarget = colorTexture;
    } else {
      this.colorAttachment.view = colorTexture;
    }
    return this.renderPassDescriptor;
  }

  async onInit(device) {
    // Override to handle initialization logic
  }

  onResize(device, size) {
    // Override to handle resizing logic
  }

  onFrame(device, context, timestamp) {
    // Override to handle frame logic
  }
}

class ResizeObserverHelper extends ResizeObserver {
  constructor(element, callback) {
    super(entries => {
      for (let entry of entries) {
        if (entry.target != element) { continue; }

        if (entry.devicePixelContentBoxSize) {
          // Should give exact pixel dimensions, but only works on Chrome.
          const devicePixelSize = entry.devicePixelContentBoxSize[0];
          callback(devicePixelSize.inlineSize, devicePixelSize.blockSize);
        } else if (entry.contentBoxSize) {
          // Firefox implements `contentBoxSize` as a single content rect, rather than an array
          const contentBoxSize = Array.isArray(entry.contentBoxSize) ? entry.contentBoxSize[0] : entry.contentBoxSize;
          callback(contentBoxSize.inlineSize, contentBoxSize.blockSize);
        } else {
          callback(entry.contentRect.width, entry.contentRect.height);
        }
      }
    });

    this.element = element;
    this.callback = callback;

    this.observe(element);
  }
}

export class OrbitCamera {
  orbitX = 0;
  orbitY = 0;
  maxOrbitX = Math.PI * 0.5;
  minOrbitX = -Math.PI * 0.5;
  maxOrbitY = Math.PI;
  minOrbitY = -Math.PI;
  constrainXOrbit = true;
  constrainYOrbit = false;

  maxDistance = 10;
  minDistance = 1;
  distanceStep = 0.005;
  constrainDistance = true;

  #distance = vec3.fromValues(0, 0, 1);
  #target = vec3.create();
  #viewMat = mat4.create();
  #cameraMat = mat4.create();
  #position = vec3.create();
  #dirty = true;

  #element;
  #registerElement;

  constructor(element = null) {
    let moving = false;
    let lastX, lastY;

    const downCallback = (event) => {
      if (event.isPrimary) {
        moving = true;
      }
      lastX = event.pageX;
      lastY = event.pageY;
    };
    const moveCallback = (event) => {
      let xDelta, yDelta;

      if(document.pointerLockEnabled) {
          xDelta = event.movementX;
          yDelta = event.movementY;
          this.orbit(xDelta * 0.025, yDelta * 0.025);
      } else if (moving) {
          xDelta = event.pageX - lastX;
          yDelta = event.pageY - lastY;
          lastX = event.pageX;
          lastY = event.pageY;
          this.orbit(xDelta * 0.025, yDelta * 0.025);
      }
    };
    const upCallback = (event) => {
      if (event.isPrimary) {
        moving = false;
      }
    };
    const wheelCallback = (event) => {
      this.distance = this.#distance[2] + (-event.wheelDeltaY * this.distanceStep);
      event.preventDefault();
    };

    this.#registerElement = (value) => {
      if (this.#element && this.#element != value) {
        this.#element.removeEventListener('pointerdown', downCallback);
        this.#element.removeEventListener('pointermove', moveCallback);
        this.#element.removeEventListener('pointerup', upCallback);
        this.#element.removeEventListener('mousewheel', wheelCallback);
      }

      this.#element = value;
      if (this.#element) {
        this.#element.addEventListener('pointerdown', downCallback);
        this.#element.addEventListener('pointermove', moveCallback);
        this.#element.addEventListener('pointerup', upCallback);
        this.#element.addEventListener('mousewheel', wheelCallback);
      }
    }

    this.#element = element;
    this.#registerElement(element);
  }

  set element(value) {
    this.#registerElement(value);
  }

  get element() {
    return this.#element;
  }

  orbit(xDelta, yDelta) {
    if(xDelta || yDelta) {
      this.orbitY += xDelta;
      if(this.constrainYOrbit) {
          this.orbitY = Math.min(Math.max(this.orbitY, this.minOrbitY), this.maxOrbitY);
      } else {
          while (this.orbitY < -Math.PI) {
              this.orbitY += Math.PI * 2;
          }
          while (this.orbitY >= Math.PI) {
              this.orbitY -= Math.PI * 2;
          }
      }

      this.orbitX += yDelta;
      if(this.constrainXOrbit) {
          this.orbitX = Math.min(Math.max(this.orbitX, this.minOrbitX), this.maxOrbitX);
      } else {
          while (this.orbitX < -Math.PI) {
              this.orbitX += Math.PI * 2;
          }
          while (this.orbitX >= Math.PI) {
              this.orbitX -= Math.PI * 2;
          }
      }

      this.#dirty = true;
    }
  }

  get target() {
    return [this.#target[0], this.#target[1], this.#target[2]];
  }

  set target(value) {
    this.#target[0] = value[0];
    this.#target[1] = value[1];
    this.#target[2] = value[2];
    this.#dirty = true;
  };

  get distance() {
    return this.#distance[2];
  };

  set distance(value) {
    this.#distance[2] = value;
    if(this.constrainDistance) {
      this.#distance[2] = Math.min(Math.max(this.#distance[2], this.minDistance), this.maxDistance);
    }
    this.#dirty = true;
  };

  #updateMatrices() {
    if (this.#dirty) {
      var mv = this.#cameraMat;
      mat4.identity(mv);

      mat4.translate(mv, mv, this.#target);
      mat4.rotateY(mv, mv, -this.orbitY);
      mat4.rotateX(mv, mv, -this.orbitX);
      mat4.translate(mv, mv, this.#distance);
      mat4.invert(this.#viewMat, this.#cameraMat);

      this.#dirty = false;
    }
  }

  get position() {
    this.#updateMatrices();
    vec3.set(this.#position, 0, 0, 0);
    vec3.transformMat4(this.#position, this.#position, this.#cameraMat);
    return this.#position;
  }

  get viewMatrix() {
    this.#updateMatrices();
    return this.#viewMat;
  }
}