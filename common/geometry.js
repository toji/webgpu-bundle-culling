import { GeometryLayoutCache, NormalizeBufferLayout } from './geometry-layout.js';

const layoutCache = new GeometryLayoutCache();

export const AttribLocation = {
  position: 0,
  normal: 1,
  tangent: 2,
  texcoord0: 3,
  texcoord1: 4,
  color: 5,
  joints: 6,
  weights: 7,
};

const DefaultAttribFormat = {
  position: 'float32x3',
  normal: 'float32x3',
  tangent: 'float32x3',
  texcoord0: 'float32x2',
  texcoord1: 'float32x2',
  color: 'float32x4',
  joints: 'uint16x4',
  weights: 'float32x4',
};

const DefaultStride = {
  uint8x2: 2,
  uint8x4: 4,
  sint8x2: 2,
  sint8x4: 4,
  unorm8x2: 2,
  unorm8x4: 4,
  snorm8x2: 2,
  snorm8x4: 4,
  uint16x2: 4,
  uint16x4: 8,
  sint16x2: 4,
  sint16x4: 8,
  unorm16x2: 4,
  unorm16x4: 8,
  snorm16x2: 4,
  snorm16x4: 8,
  float16x2: 4,
  float16x4: 8,
  float32: 4,
  float32x2: 8,
  float32x3: 12,
  float32x4: 16,
  uint32: 4,
  uint32x2: 8,
  uint32x3: 12,
  uint32x4: 16,
  sint32: 4,
  sint32x2: 8,
  sint32x3: 12,
  sint32x4: 16,
};

/**
 * Definition of an attribute for a Geometry
 * @typedef {ArrayBuffer | TypedArray | number[]} GeometryAttributeValues
 */

/**
 * Definition of an attribute for a Geometry
 * @typedef {Object} AttributeDescriptor
 * @prop {GeometryAttributeValues} values
 * @prop {number} [offset=0]
 * @prop {number} [stride]
 * @prop {GPUVertexFormat} [format]
 */

/**
 * Definition of an attribute for a Geometry
 * @typedef {GeometryAttributeValues | AttributeDescriptor} GeometryAttribute
 */

/**
 * Description of the Geometry to be created
 * @typedef {Object} GeometryDescriptor
 * @prop {string} label - An arbitary label used to identify this Geometry. May be used to label related WebGPU objects.
 * @prop {GeometryAttribute} position
 * @prop {GeometryAttribute} [normal]
 * @prop {GeometryAttribute} [tangent]
 * @prop {GeometryAttribute} [texcoord0]
 * @prop {GeometryAttribute} [texcoord1]
 * @prop {GeometryAttribute} [color]
 * @prop {GeometryAttribute} [joints]
 * @prop {GeometryAttribute} [weights]
 * @prop {number} [drawCount]
 * @prop {Uint16Array | Uint32Array | number[]} [indices]
 * @prop {GPUPrimitiveTopology} [topology]
 */

function buildGeometry(device, desc) {
  let vertexBufferLayouts = [];
  let maxVertices = Number.MAX_SAFE_INTEGER;

  let arraySource = new Map();
  let requiredBufferSize = 0;
  for (const attribName of Object.keys(AttribLocation)) {
    const attrib = desc[attribName];
    if (attrib === undefined) { continue; }

    const values = attrib.values ?? attrib;

    const format = attrib?.format ?? DefaultAttribFormat[attribName];
    const arrayStride = attrib?.stride ?? DefaultStride[format];
    const offset = attrib.offset ?? 0;
    const shaderLocation = AttribLocation[attribName];

    // Figure out how much space each attribute will require. Does
    // some basic de-duping of attrib values to prevent the same array from
    // being uploaded twice.
    let source = arraySource.get(values);
    if (!source) {
      let byteArray;
      if (ArrayBuffer.isView(values)) {
        byteArray = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      } else if (values instanceof ArrayBuffer) {
        byteArray = new Uint8Array(values);
      } else if (Array.isArray(values)) {
        // TODO: Should this be based on the attrib type?
        byteArray = new Uint8Array(new Float32Array(values).buffer);
      } else {
        throw new Error(`Unknown values type in attribute ${attribName}`);
      }

      source = {
        byteArray,
        bufferOffset: requiredBufferSize,
        size: byteArray.byteLength,
      };
      arraySource.set(values, source);

      requiredBufferSize += Math.ceil(byteArray.byteLength / 4) * 4;
      maxVertices = Math.min(maxVertices, byteArray.byteLength / arrayStride);
    }

    vertexBufferLayouts.push({
      buffer: values,
      arrayStride,
      attributes: [{
        shaderLocation,
        format,
        offset: offset + source.bufferOffset,
      }]
    });
  }

  if (requiredBufferSize == 0) {
    throw new Error('No vertex data provided');
  }

  const bufferLayouts = NormalizeBufferLayout([...vertexBufferLayouts.values()]);

  // Allocate a GPUBuffer of the required size and copy all the array values
  // into it.
  const vertexBuffer = device.createBuffer({
    label: `${desc.label ?? ''}_VertexBuffer`,
    size: requiredBufferSize,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  const vertexBufferArray = new Uint8Array(vertexBuffer.getMappedRange());
  for (const source of arraySource.values()) {
    vertexBufferArray.set(source.byteArray, source.bufferOffset);
  }
  vertexBuffer.unmap();

  const vertexBindings = [];
  for (const layout of bufferLayouts) {
    vertexBindings.push({
      buffer: vertexBuffer,
      offset: layout.bufferOffset,
      size: arraySource.get(layout.buffer).size,
    });
  }

  // Create and fill the index buffer
  let indexArray = null;
  if (desc.indices) {
    if (Array.isArray(desc.indices)) {
      indexArray = new Uint32Array(desc.indices);
    } else {
      indexArray = desc.indices;
    }
  }

  const indexFormat = indexArray instanceof Uint16Array ? 'uint16' : 'uint32';
  const layout = layoutCache.createLayout(bufferLayouts, desc.topology ?? 'triangle-list', indexFormat);

  let indexBinding;
  if (indexArray) {
    const indexBuffer = device.createBuffer({
      label: `${desc.label ?? ''}_IndexBuffer`,
      size: indexArray.byteLength,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    const indexBufferArray = new indexArray.constructor(indexBuffer.getMappedRange());
    indexBufferArray.set(indexArray);
    indexBuffer.unmap();

    indexBinding = {
      format: indexFormat,
      buffer: indexBuffer,
      offset: 0,
      size: indexArray.byteLength,
    }
  }

  let drawCount = desc.drawCount;
  if (drawCount === undefined) {
    if (indexArray) {
      drawCount = indexArray.length;
    } else {
      drawCount = maxVertices;
    }
  }

  return {
    layout,
    vertexBindings,
    indexBinding,
    drawCount,
  }

  // TODO: Return
}

export class Geometry {

  /**
   * 
   * @param {GPUDevice} device 
   * @param {GeometryDescriptor} desc 
   */
  constructor(device, desc) {
    this.device = device;
    this.label = desc.label;

    const geom = buildGeometry(device, desc);
    this.layout = geom.layout;
    this.vertexBindings = geom.vertexBindings;
    this.indexBinding = geom.indexBinding;
    this.drawCount = geom.drawCount;
  }

  /**
   * Sets the Vertex and Index buffers for this geometry
   * @param {GPURenderPassEncoder} renderPass 
   */
  setBuffers(renderPass) {
    for (let i = 0; i < this.vertexBindings.length; ++i) {
      const binding = this.vertexBindings[i];
      renderPass.setVertexBuffer(i, binding.buffer, binding.offset, binding.size);
    }

    if (this.indexBinding) {
      const binding = this.indexBinding;
      renderPass.setIndexBuffer(binding.buffer, binding.format, binding.offset, binding.size);
    }
  }

  draw(renderPass, instanceCount, firstInstance) {
    if (this.indexBinding) {
      renderPass.drawIndexed(this.drawCount, instanceCount, 0, 0, firstInstance);
    } else {
      renderPass.draw(this.drawCount, instanceCount, 0, firstInstance);
    }
  }

  static getLayoutCache() {
    return layoutCache;
  }
}
