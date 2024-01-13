import { Geometry } from "./geometry.js";
import { vec3 } from 'https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js';

export class BoxGeometryDesc {
  constructor(options = {}) {
    const w = (options.width ?? 1) * 0.5;
    const h = (options.height ?? 1) * 0.5;
    const d = (options.depth ?? 1) * 0.5;

    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const z = options.z ?? 0;

    const boxVertArray = new Float32Array([
      //position,     normal,    uv,
      x+w, y-h, z+d,  0, -1, 0,  1, 1,
      x-w, y-h, z+d,  0, -1, 0,  0, 1,
      x-w, y-h, z-d,  0, -1, 0,  0, 0,
      x+w, y-h, z-d,  0, -1, 0,  1, 0,
      x+w, y-h, z+d,  0, -1, 0,  1, 1,
      x-w, y-h, z-d,  0, -1, 0,  0, 0,

      x+w, y+h, z+d,  1, 0, 0,   1, 1,
      x+w, y-h, z+d,  1, 0, 0,   0, 1,
      x+w, y-h, z-d,  1, 0, 0,   0, 0,
      x+w, y+h, z-d,  1, 0, 0,   1, 0,
      x+w, y+h, z+d,  1, 0, 0,   1, 1,
      x+w, y-h, z-d,  1, 0, 0,   0, 0,

      x-w, y+h, z+d,  0, 1, 0,   1, 1,
      x+w, y+h, z+d,  0, 1, 0,   0, 1,
      x+w, y+h, z-d,  0, 1, 0,   0, 0,
      x-w, y+h, z-d,  0, 1, 0,   1, 0,
      x-w, y+h, z+d,  0, 1, 0,   1, 1,
      x+w, y+h, z-d,  0, 1, 0,   0, 0,

      x-w, y-h, z+d,  -1, 0, 0,  1, 1,
      x-w, y+h, z+d,  -1, 0, 0,  0, 1,
      x-w, y+h, z-d,  -1, 0, 0,  0, 0,
      x-w, y-h, z-d,  -1, 0, 0,  1, 0,
      x-w, y-h, z+d,  -1, 0, 0,  1, 1,
      x-w, y+h, z-d,  -1, 0, 0,  0, 0,

      x+w, y+h, z+d,  0, 0, 1,   1, 1,
      x-w, y+h, z+d,  0, 0, 1,   0, 1,
      x-w, y-h, z+d,  0, 0, 1,   0, 0,
      x-w, y-h, z+d,  0, 0, 1,   0, 0,
      x+w, y-h, z+d,  0, 0, 1,   1, 0,
      x+w, y+h, z+d,  0, 0, 1,   1, 1,

      x+w, y-h, z-d,  0, 0, -1,  1, 1,
      x-w, y-h, z-d,  0, 0, -1,  0, 1,
      x-w, y+h, z-d,  0, 0, -1,  0, 0,
      x+w, y+h, z-d,  0, 0, -1,  1, 0,
      x+w, y-h, z-d,  0, 0, -1,  1, 1,
      x-w, y+h, z-d,  0, 0, -1,  0, 0,
    ]);

    this.label = options.label;
    this.position = { values: boxVertArray, stride: 32 };
    this.normal = { values: boxVertArray, stride: 32, offset: 12 };
    this.texcoord0 = { values: boxVertArray, stride: 32, offset: 24 };
  }
}

// Big swaths of this code lifted with love from Three.js
export class SphereGeometryDesc {
  constructor(device, options = {}) {
    const radius = options.radius ?? 0.5;
    const widthSegments = Math.max( 3, Math.floor( options.widthSegments ?? 32 ) );
    const heightSegments = Math.max( 2, Math.floor( options.heightSegments ?? 16 ) );

    const phiStart = 0;
    const phiLength = Math.PI * 2;
    const thetaStart = 0;
    const thetaLength = Math.PI;

    const thetaEnd = Math.min( thetaStart + thetaLength, Math.PI );

    const x = options.x ?? 0;
    const y = options.y ?? 0;
    const z = options.z ?? 0;

    let index = 0;
    const grid = [];

    const vertex = vec3.create();
    const normal = vec3.create();

    // buffers

    const vertices = [];
    const indices = [];

    // generate vertices, normals and uvs

    for (let iy = 0; iy <= heightSegments; ++iy) {
      const verticesRow = [];
      const v = iy / heightSegments;

      // special case for the poles
      let uOffset = 0;
      if (iy == 0 && thetaStart == 0) {
        uOffset = 0.5 / widthSegments;
      } else if (iy == heightSegments && thetaEnd == Math.PI) {
        uOffset = - 0.5 / widthSegments;
      }

      for (let ix = 0; ix <= widthSegments; ++ix) {
        const u = ix / widthSegments;

        // vertex
        vertex[0] = -radius * Math.cos(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);
        vertex[1] = radius * Math.cos(thetaStart + v * thetaLength);
        vertex[2] = radius * Math.sin(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength);

        vertices.push(vertex[0] + x, vertex[1] + y, vertex[2] + z);

        // normal
        vec3.normalize(normal, vertex);
        vertices.push(normal[0], normal[1], normal[2]);

        // texcoord
        vertices.push(u + uOffset, 1 - v);

        verticesRow.push(index++);
      }

      grid.push(verticesRow);
    }

    // indices

    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = grid[iy][ix + 1];
        const b = grid[iy][ix];
        const c = grid[iy + 1][ix];
        const d = grid[iy + 1][ix + 1];

        if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
        if (iy !== heightSegments - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
      }
    }

    const vertArray = new Float32Array(vertices);


    this.label = options.label;
    this.position = { values: vertArray, stride: 32 };
    this.normal = { values: vertArray, stride: 32, offset: 12 };
    this.texcoord0 = { values: vertArray, stride: 32, offset: 24 };
    this.indices = new Uint16Array(indices);
  }
}

export class CylinderGeometryDesc {
  constructor(device, options = {}) {
    const radiusTop = options.radiusTop ?? 0.5;
    const radiusBottom = options.radiusBottom ?? 0.5;
    const height = options.height ?? 1;
    const radialSegments = Math.floor(options.radialSegments ?? 32);
    const heightSegments = Math.floor(options.heightSegments ?? 1);
    const openEnded = options.openEnded ?? false;
    const thetaStart = options.thetaStart ?? 0;
    const thetaLength = options.thetaLength ?? Math.PI * 2;

    const offsetX = options.x ?? 0;
    const offsetY = options.y ?? 0;
    const offsetZ = options.z ?? 0;

    // buffers
    const indices = [];
    const vertices = [];

    // helper variables
    let index = 0;
    const indexArray = [];
    const halfHeight = height / 2;

    // generate geometry
    generateTorso();
    if ( openEnded === false ) {
      if (radiusTop > 0) generateCap(true);
      if (radiusBottom > 0) generateCap(false);
    }

    const vertexArray = new Float32Array(vertices);

    this.label = options.label;
    this.position = {values: vertexArray, stride: 32};
    this.normal = {values: vertexArray, stride: 32, offset: 12};
    this.texcoord0 = {values: vertexArray, stride: 32, offset: 24};
    this.indices = new Uint16Array(indices);

    // build geometry
    function generateTorso() {
      const normal = vec3.create();

      // this will be used to calculate the normal
      const slope = (radiusBottom - radiusTop) / height;

      // generate vertices, normals and uvs
      for (let y = 0; y <= heightSegments; ++y) {
        const indexRow = [];
        const v = y / heightSegments;

        // calculate the radius of the current row
        const radius = v * (radiusBottom - radiusTop) + radiusTop;

        for (let x = 0; x <= radialSegments; ++x) {
          const u = x / radialSegments;
          const theta = u * thetaLength + thetaStart;

          const sinTheta = Math.sin(theta);
          const cosTheta = Math.cos(theta);

          // vertex
          vertices.push(
            radius * sinTheta + offsetX,
            (-v * height + halfHeight) + offsetY,
            radius * cosTheta + offsetZ
          );

          // normal
          vec3.normalize(normal, [sinTheta, slope, cosTheta]);
          vertices.push(...normal);

          // uv
          vertices.push(u, 1 - v);

          // save index of vertex in respective row
          indexRow.push(index++);
        }

        // now save vertices of the row in our index array
        indexArray.push(indexRow);
      }

      // generate indices
      for (let x = 0; x < radialSegments; ++x) {
        for (let y = 0; y < heightSegments; ++y) {
          // we use the index array to access the correct indices
          const a = indexArray[y][x];
          const b = indexArray[y + 1][x];
          const c = indexArray[y + 1][x + 1];
          const d = indexArray[y][x + 1];

          // faces
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
    }

    function generateCap(top) {
      // save the index of the first center vertex
      const centerIndexStart = index;

      const radius = (top === true) ? radiusTop : radiusBottom;
      const sign = (top === true) ? 1 : -1;

      // first we generate the center vertex data of the cap.
      // because the geometry needs one set of uvs per face,
      // we must generate a center vertex per face/segment
      for (let x = 1; x <= radialSegments; ++x) {
        // vertex
        vertices.push(
          offsetX,
          halfHeight * sign + offsetY,
          offsetZ
        );

        // normal
        vertices.push(0, sign, 0);

        // uv
        vertices.push(0.5, 0.5);

        // increase index
        ++index;
      }

      // save the index of the last center vertex
      const centerIndexEnd = index;

      // now we generate the surrounding vertices, normals and uvs
      for (let x = 0; x <= radialSegments; ++x) {
        const u = x / radialSegments;
        const theta = u * thetaLength + thetaStart;

        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        // vertex
        vertices.push(
          radius * sinTheta + offsetX,
          halfHeight * sign + offsetY,
          radius * cosTheta + offsetZ
        );

        // normal
        vertices.push(0, sign, 0);

        // uv
        vertices.push(
          (cosTheta * 0.5) + 0.5,
          (sinTheta * 0.5 * sign) + 0.5
        );

        // increase index
        ++index;
      }

      // generate indices
      for (let x = 0; x < radialSegments; ++x) {
        const c = centerIndexStart + x;
        const i = centerIndexEnd + x;

        if (top === true) {
          // face top
          indices.push(i, i + 1, c);
        } else {
          // face bottom
          indices.push(i + 1, i, c);
        }
      }
    }
  }
}

export class ConeGeometryDesc extends CylinderGeometryDesc {
  constructor(device, options = {}) {
    super(device, {
      ...options,
      radiusTop: 0,
      radiusBottom: options.radius,
    });
  }
}
