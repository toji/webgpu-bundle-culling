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

function buildGeometryBatch(device, descArray) {
  let arraySource = new Map();
  let requiredVertexBufferSize = 0;
  let requiredIndexBufferSize = 0;

  const geometries = [];

  for (const desc of descArray) {
    let vertexBufferLayouts = [];
    let maxVertices = Number.MAX_SAFE_INTEGER;

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
          bufferOffset: requiredVertexBufferSize,
          size: byteArray.byteLength,
        };
        arraySource.set(values, source);

        requiredVertexBufferSize += Math.ceil(byteArray.byteLength / 4) * 4;
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

    // Create and fill the index buffer
    let indexBinding;
    let indexArray = null;
    let indexFormat;

    if (desc.indices) {
      if (Array.isArray(desc.indices)) {
        const u32Array = new Uint32Array(desc.indices);
        indexArray = new Uint8Array(u32Array.buffer, 0, u32Array.byteLength);
        indexFormat = 'uint32';
      } else {
        indexFormat = desc.indices instanceof Uint16Array ? 'uint16' : 'uint32';
        indexArray = new Uint8Array(desc.indices.buffer, desc.indices.byteOffset, desc.indices.byteLength);
      }

      indexBinding = {
        format: indexFormat,
        buffer: indexArray,
        offset: requiredIndexBufferSize,
        size: indexArray.byteLength,
        firstIndex: 0,
      };

      requiredIndexBufferSize += indexArray.byteLength;
    }

    const bufferLayouts = NormalizeBufferLayout([...vertexBufferLayouts.values()]);
    const layout = layoutCache.createLayout(bufferLayouts, desc.topology ?? 'triangle-list', indexFormat);

    const vertexBindings = [];
    for (const layout of bufferLayouts) {
      vertexBindings.push({
        buffer: null, // Will be populated after
        offset: layout.bufferOffset,
        size: arraySource.get(layout.buffer).size,
      });
    }

    let drawCount = desc.drawCount;
    if (drawCount === undefined) {
      if (indexArray) {
        drawCount = desc.indices.length;
      } else {
        drawCount = maxVertices;
      }
    }

    geometries.push({
      layout,
      vertexBindings,
      indexBinding,
      drawCount,
    });
  }

  if (requiredVertexBufferSize == 0) {
    throw new Error('No vertex data provided');
  }

  // Allocate a GPUBuffer of the required size and copy all the array values
  // into it.
  const vertexBuffer = device.createBuffer({
    label: `BatchVertexBuffer`,
    size: requiredVertexBufferSize,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  const vertexBufferArray = new Uint8Array(vertexBuffer.getMappedRange());
  for (const source of arraySource.values()) {
    vertexBufferArray.set(source.byteArray, source.bufferOffset);
  }
  vertexBuffer.unmap();

  for (const geometry of geometries) {
    for (const binding of geometry.vertexBindings) {
      binding.buffer = vertexBuffer;
    }
  }

  if (requiredIndexBufferSize > 0) {
    const indexBuffer = device.createBuffer({
      label: `BatchIndexBuffer`,
      size: requiredIndexBufferSize,
      usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true,
    });
    const indexBufferArray = new Uint8Array(indexBuffer.getMappedRange());

    for (const geometry of geometries) {
      if (geometry.indexBinding) {
        indexBufferArray.set(geometry.indexBinding.buffer, geometry.indexBinding.offset);
        geometry.indexBinding.buffer = indexBuffer;

        // In order to make indirect drawing validation faster in Chrome, reset the binding offset and size to 0 while
        // setting the firstIndex to the approrpriate offset.
        geometry.indexBinding.firstIndex = geometry.indexBinding.format == 'uint16' ? geometry.indexBinding.offset / 2 : geometry.indexBinding.offset / 4;
        geometry.indexBinding.offset = 0;
        geometry.indexBinding.size = undefined;
      }
    }

    indexBuffer.unmap();
  }

  return geometries;
}

export class Geometry {
  /**
   *
   * @param {GPUDevice} device
   * @param {GeometryDescriptor} desc
   */
  constructor(device, geomOrDesc) {
    this.device = device;

    let geom;
    if (geomOrDesc.vertexBindings) {
      geom = geomOrDesc;
    } else {
      geom = buildGeometryBatch(device, [geomOrDesc])[0];
    }

    this.layout = geom.layout;
    this.vertexBindings = geom.vertexBindings;
    this.indexBinding = geom.indexBinding;
    this.drawCount = geom.drawCount;
  }

  static CreateBatch(device, descArray) {
    return buildGeometryBatch(device, descArray).map((g) => new Geometry(device, g));
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
      renderPass.drawIndexed(this.drawCount, instanceCount, this.indexBinding.firstIndex, 0, firstInstance);
    } else {
      renderPass.draw(this.drawCount, instanceCount, 0, firstInstance);
    }
  }

  static getLayoutCache() {
    return layoutCache;
  }
}
