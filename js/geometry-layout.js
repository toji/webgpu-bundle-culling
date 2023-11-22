// A GeometryLayout describes the buffer layout, topology, and stripIndexFormat of a piece of
// geometry, which makes up a good percentage of the information needed when building a render
// pipeline. It can be serialized and deserialized to and from a very compact string form, which
// can then be used as a key for cache lookups or transmitting over a wire.
//
// The GeometryLayoutCache uses the serialized form of the GeometryLayout to dedup them and assign
// a unique ID to each, which is then even easier to use for cache lookups (though only for the
// given session.)
var TopologyId;
(function (TopologyId) {
    TopologyId[TopologyId["point-list"] = 0] = "point-list";
    TopologyId[TopologyId["line-list"] = 1] = "line-list";
    TopologyId[TopologyId["line-strip"] = 2] = "line-strip";
    TopologyId[TopologyId["triangle-strip"] = 3] = "triangle-strip";
    TopologyId[TopologyId["triangle-list"] = 4] = "triangle-list";
})(TopologyId || (TopologyId = {}));
;
const TopologyMask = TopologyId["point-list"] |
    TopologyId["line-list"] |
    TopologyId["line-strip"] |
    TopologyId["triangle-strip"] |
    TopologyId["triangle-list"];
var StripIndexFormatId;
(function (StripIndexFormatId) {
    StripIndexFormatId[StripIndexFormatId["uint16"] = 0] = "uint16";
    StripIndexFormatId[StripIndexFormatId["uint32"] = 8] = "uint32";
})(StripIndexFormatId || (StripIndexFormatId = {}));
;
var FormatId;
(function (FormatId) {
    FormatId[FormatId["uint8x2"] = 0] = "uint8x2";
    FormatId[FormatId["uint8x4"] = 1] = "uint8x4";
    FormatId[FormatId["sint8x2"] = 2] = "sint8x2";
    FormatId[FormatId["sint8x4"] = 3] = "sint8x4";
    FormatId[FormatId["unorm8x2"] = 4] = "unorm8x2";
    FormatId[FormatId["unorm8x4"] = 5] = "unorm8x4";
    FormatId[FormatId["snorm8x2"] = 6] = "snorm8x2";
    FormatId[FormatId["snorm8x4"] = 7] = "snorm8x4";
    FormatId[FormatId["uint16x2"] = 8] = "uint16x2";
    FormatId[FormatId["uint16x4"] = 9] = "uint16x4";
    FormatId[FormatId["sint16x2"] = 10] = "sint16x2";
    FormatId[FormatId["sint16x4"] = 11] = "sint16x4";
    FormatId[FormatId["unorm16x2"] = 12] = "unorm16x2";
    FormatId[FormatId["unorm16x4"] = 13] = "unorm16x4";
    FormatId[FormatId["snorm16x2"] = 14] = "snorm16x2";
    FormatId[FormatId["snorm16x4"] = 15] = "snorm16x4";
    FormatId[FormatId["float16x2"] = 16] = "float16x2";
    FormatId[FormatId["float16x4"] = 17] = "float16x4";
    FormatId[FormatId["float32"] = 18] = "float32";
    FormatId[FormatId["float32x2"] = 19] = "float32x2";
    FormatId[FormatId["float32x3"] = 20] = "float32x3";
    FormatId[FormatId["float32x4"] = 21] = "float32x4";
    FormatId[FormatId["uint32"] = 22] = "uint32";
    FormatId[FormatId["uint32x2"] = 23] = "uint32x2";
    FormatId[FormatId["uint32x3"] = 24] = "uint32x3";
    FormatId[FormatId["uint32x4"] = 25] = "uint32x4";
    FormatId[FormatId["sint32"] = 26] = "sint32";
    FormatId[FormatId["sint32x2"] = 27] = "sint32x2";
    FormatId[FormatId["sint32x3"] = 28] = "sint32x3";
    FormatId[FormatId["sint32x4"] = 29] = "sint32x4";
})(FormatId || (FormatId = {}));
;
var StepModeId;
(function (StepModeId) {
    StepModeId[StepModeId["vertex"] = 0] = "vertex";
    StepModeId[StepModeId["instance"] = 32768] = "instance";
})(StepModeId || (StepModeId = {}));
;
const Uint8ToHex = new Array(256);
for (let i = 0; i <= 0xFF; ++i) {
    Uint8ToHex[i] = i.toString(16).padStart(2, '0');
}
const HexToUint8 = new Array(256);
for (let i = 0; i <= 0xFF; ++i) {
    HexToUint8[i.toString(16).padStart(2, '0')] = i;
}
export class GeometryLayout {
    id;
    buffers;
    topology;
    stripIndexFormat;
    #serializedBuffer;
    #serializedString;
    #locationsUsed;
    #locationsFormats;
    constructor(buffers, topology, indexFormat = 'uint32') {
        this.buffers = buffers;
        this.topology = topology;
        if (topology == 'triangle-strip' || topology == 'line-strip') {
            this.stripIndexFormat = indexFormat;
        }
    }
    get locationsUsed() {
        if (!this.#locationsUsed) {
            this.#locationsUsed = new Set();
            for (const buffer of this.buffers) {
                for (const attrib of buffer.attributes) {
                    this.#locationsUsed.add(attrib.shaderLocation);
                }
            }
        }
        return this.#locationsUsed;
    }
    getLocationFormat(shaderLocation) {
        if (!this.#locationsFormats) {
            this.#locationsFormats = new Map();
            for (const buffer of this.buffers) {
                for (const attrib of buffer.attributes) {
                    this.#locationsFormats.set(attrib.shaderLocation, attrib.format);
                }
            }
        }
        return this.#locationsFormats.get(shaderLocation);
    }
    getLocationBaseType(shaderLocation) {
        const format = this.getLocationFormat(shaderLocation);
        if (format.startsWith('float') || format.startsWith('unorm') || format.startsWith('unorm')) {
            return 'f32';
        }
        else if (format.startsWith('uint')) {
            return 'u32';
        }
        else if (format.startsWith('sint')) {
            return 'i32';
        }
        // Should not get here.
        console.warn(`Shader Location ${shaderLocation} has format "${format}" with an unknown base type.`);
        return null;
    }
    serializeToBuffer() {
        if (this.#serializedBuffer) {
            return this.#serializedBuffer;
        }
        let attribCount = 0;
        for (const buffer of this.buffers) {
            attribCount += buffer.attributes.length;
        }
        // Each buffer takes 2 bytes to encode and each attribute takes 3 bytes.
        // The primitive topology takes 1 byte.
        const byteLength = 1 + (this.buffers.length * 2) + attribCount * 3;
        const outBuffer = new ArrayBuffer(byteLength);
        const dataView = new DataView(outBuffer);
        let topologyData8 = TopologyId[this.topology];
        if (this.stripIndexFormat !== undefined) {
            topologyData8 += StripIndexFormatId[this.stripIndexFormat];
        }
        dataView.setUint8(0, topologyData8);
        let offset = 1;
        for (const buffer of this.buffers) {
            let bufferData16 = buffer.attributes.length; // Lowest 4 bits
            bufferData16 += buffer.arrayStride << 4; // Middle 11 bits
            bufferData16 += StepModeId[buffer.stepMode || 'vertex']; // Highest bit
            dataView.setUint16(offset, bufferData16, true);
            offset += 2;
            for (const attrib of buffer.attributes) {
                let attribData16 = attrib.offset || 0; // Lowest 12 bits
                attribData16 += attrib.shaderLocation << 12; // Highest 4 bits
                dataView.setUint16(offset, attribData16, true);
                dataView.setUint8(offset + 2, FormatId[attrib.format]);
                offset += 3;
            }
        }
        this.#serializedBuffer = outBuffer;
        return outBuffer;
    }
    serializeToString() {
        if (this.#serializedString) {
            return this.#serializedString;
        }
        const array = new Uint8Array(this.serializeToBuffer());
        let outStr = '';
        for (let i = 0; i < array.length; ++i) {
            outStr += Uint8ToHex[array[i]];
        }
        this.#serializedString = outStr;
        return outStr;
    }
    static deserializeFromBuffer(inBuffer, bufferOffest, bufferLength) {
        const dataView = new DataView(inBuffer, bufferOffest, bufferLength);
        const topologyData8 = dataView.getUint8(0);
        const topology = TopologyId[topologyData8 & TopologyMask];
        let stripIndexFormat = 'uint32';
        switch (topology) {
            case 'triangle-strip':
            case 'line-strip':
                stripIndexFormat = StripIndexFormatId[topologyData8 & 0x08];
        }
        const buffers = [];
        let offset = 1;
        while (offset < dataView.byteLength) {
            const bufferData16 = dataView.getUint16(offset, true);
            const attribCount = bufferData16 & 0x0F;
            let buffer = {
                attributes: new Array(attribCount),
                arrayStride: (bufferData16 >> 4) & 0x08FF,
                stepMode: StepModeId[bufferData16 & 0x8000],
            };
            buffers.push(buffer);
            offset += 2;
            for (let i = 0; i < attribCount; ++i) {
                const attribData16 = dataView.getUint16(offset, true);
                buffer.attributes[i] = {
                    offset: attribData16 & 0x0FFF,
                    shaderLocation: (attribData16 >> 12) & 0x0F,
                    format: FormatId[dataView.getUint8(offset + 2)]
                };
                offset += 3;
            }
        }
        return new GeometryLayout(buffers, topology, stripIndexFormat);
    }
    static deserializeFromString(value) {
        const array = new Uint8Array(value.length / 2);
        for (let i = 0; i < array.length; ++i) {
            const strOffset = i * 2;
            array[i] = HexToUint8[value.substring(strOffset, strOffset + 2)];
        }
        const layout = GeometryLayout.deserializeFromBuffer(array.buffer);
        layout.#serializedBuffer = array.buffer;
        layout.#serializedString = value;
        return layout;
    }
}
;
export class GeometryLayoutCache {
    #nextId = 1;
    #keyMap = new Map(); // Map of the given key to an ID
    #cache = new Map(); // Map of ID to cached resource
    getLayout(id) {
        return this.#cache.get(id);
    }
    addLayoutToCache(layout, key) {
        layout.id = this.#nextId++;
        Object.freeze(layout);
        this.#keyMap.set(key, layout.id);
        this.#cache.set(layout.id, layout);
        return layout;
    }
    deserializeLayout(key) {
        const id = this.#keyMap.get(key);
        if (id !== undefined) {
            return this.#cache.get(id);
        }
        const layout = GeometryLayout.deserializeFromString(key);
        return this.addLayoutToCache(layout, key);
    }
    createLayout(attribBuffers, topology, indexFormat = 'uint32') {
        const buffers = [];
        // Copy the attribBuffers, because the GeometryLayout will take ownership of them.
        for (const buffer of attribBuffers) {
            const attributes = [];
            for (const attrib of buffer.attributes) {
                attributes.push({
                    shaderLocation: attrib.shaderLocation,
                    format: attrib.format,
                    offset: attrib.offset,
                });
            }
            buffers.push({
                arrayStride: buffer.arrayStride,
                attributes
            });
        }
        const layout = new GeometryLayout(buffers, topology, indexFormat);
        const key = layout.serializeToString();
        const id = this.#keyMap.get(key);
        if (id !== undefined) {
            return this.#cache.get(id);
        }
        return this.addLayoutToCache(layout, key);
    }
}
;
// This function takes an array of buffers and the attributes associated with them and combines and
// sort, and adjust them in such a way that they have the maximum chance of matching other buffer
// layouts and thus reducing the number of pipelines needed.
//
// The function takes in an array of layouts including the buffer, buffer offset, stride, and
// attributes. Then it returns the same but reorganized and possibly compibned. The output array
// may not have the same number of elements as the input array, and the buffers may have different
// offsets than the ones specified in the inputs! Also, the buffer passed in does not need to be a
// GPUBuffer, it can be any value you want (such as an index) that can be used as a Map key.
export function NormalizeBufferLayout(bufferLayouts) {
    // Do a first pass over the inputs to sort first by buffer, then by stride.
    const bufferStrideAttribs = new Map();
    for (const layout of bufferLayouts) {
        // Skip any buffers that don't have attributes. (Why did you even define that buffer?)
        if (layout.attributes.length == 0) {
            continue;
        }
        let bufferStrides = bufferStrideAttribs.get(layout.buffer);
        if (!bufferStrides) {
            bufferStrides = new Map();
            bufferStrideAttribs.set(layout.buffer, bufferStrides);
        }
        let strideAttribs = bufferStrides.get(layout.arrayStride);
        if (!strideAttribs) {
            strideAttribs = [];
            bufferStrides.set(layout.arrayStride, strideAttribs);
        }
        for (const attrib of layout.attributes) {
            // The buffer and attribute offsets
            strideAttribs.push({
                shaderLocation: attrib.shaderLocation,
                offset: attrib.offset + (layout.bufferOffset ?? 0),
                format: attrib.format,
            });
        }
    }
    const normalizedLayouts = [];
    const pushLayout = (buffer, bufferOffset, arrayStride, attributes) => {
        normalizedLayouts.push({
            buffer,
            bufferOffset,
            arrayStride,
            attributes: attributes.sort((a, b) => a.shaderLocation - b.shaderLocation)
        });
    };
    // Now, for each buffer/stride combo find the minimum offset used by any of the attributes and treat that as the
    // buffer binding offset instead. Then split any buffers where the adjusted offset is greater than the
    // stride into separate buffers.
    for (const [buffer, strideAttribs] of bufferStrideAttribs) {
        for (const [stride, attribs] of strideAttribs) {
            // Sort the attributes by offset so that interleaved attributes are grouped.
            attribs.sort((a, b) => a.offset - b.offset);
            // Get the minimum offset from all of the attributes. That will be the final buffer offset.
            let minAttribOffset = attribs[0].offset;
            let attributes = [];
            for (const attrib of attribs) {
                let adjustedOffset = attrib.offset - minAttribOffset;
                // Sometimes attribs will be fed in that are separate arrays but packed into the same buffer.
                // If the offset is greater than the stride, just treat it as a new buffer with the bigger
                // offset as the base.
                if (adjustedOffset >= stride) {
                    pushLayout(buffer, minAttribOffset, stride, attributes);
                    minAttribOffset = attrib.offset;
                    adjustedOffset = 0;
                    attributes = [];
                }
                attributes.push({
                    offset: adjustedOffset,
                    shaderLocation: attrib.shaderLocation,
                    format: attrib.format,
                });
            }
            pushLayout(buffer, minAttribOffset, stride, attributes);
        }
    }
    // Finally, sort the buffer layouts by their first attribute's shader location and return.
    return normalizedLayouts.sort((a, b) => a.attributes[0].shaderLocation - b.attributes[0].shaderLocation);
}
;
//# sourceMappingURL=geometry-layout.js.map