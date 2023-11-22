const AVG_SAMPLE_COUNT = 100;

export class PassTimestampHelper {
  device;
  #timestampsSupported = false;

  timestampQuerySet;
  timestampResolveBuffer;
  timestampReadbackBuffers = [];
  #readbackBufferCount = 0;

  #passTimings = new Map();

  #maxPassCount = 0;
  #nextQueryIndex = 0;
  #queriesUsed = new Map();

  constructor(device, maxPassCount = 16) {
    this.device = device;
    this.#maxPassCount = maxPassCount;
    this.#timestampsSupported = this.device.features.has('timestamp-query');

    if (this.#timestampsSupported) {
      this.timestampQuerySet = this.device.createQuerySet({
          label: 'Timestamp Helper',
          type: 'timestamp',
          count: this.#maxPassCount,
      });
  
      this.timestampResolveBuffer = this.device.createBuffer({
          size: BigUint64Array.BYTES_PER_ELEMENT * this.#maxPassCount,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
    }
  }

  get timestampsSupported() {
    return this.#timestampsSupported;
  }

  timestampWrites(name) {
    if (!this.#timestampsSupported) { return undefined; }

    if (this.#currentReadbackBuffer) {
      throw new Error('Must read back the previous resolve before new timestampes can be added.');
    }

    if (this.#nextQueryIndex >= this.#maxPassCount * 2) {
      throw new Error('Exceeded the number of passes that can be queried in a single resolve.');
    }

    const timestampWrites = {
      querySet: this.timestampQuerySet,
      beginningOfPassWriteIndex: this.#nextQueryIndex,
      endOfPassWriteIndex: this.#nextQueryIndex + 1
    };

    this.#queriesUsed.set(name, {
      begin: timestampWrites.beginningOfPassWriteIndex,
      end: timestampWrites.endOfPassWriteIndex,
    });
    this.#nextQueryIndex += 2;
    return timestampWrites;
  }

  resolve(commandEncoder) {
    if (!this.#timestampsSupported) { return; }

    if (this.#currentReadbackBuffer) {
      throw new Error('Must read back the previous resolve before resolve can be called again.');
    }

    if (this.timestampReadbackBuffers.length > 0) {
      this.#currentReadbackBuffer = this.timestampReadbackBuffers.pop();
    } else {
      this.#currentReadbackBuffer = this.device.createBuffer({
        label: `Timestamp Readback ${this.#readbackBufferCount}`,
        size: this.timestampResolveBuffer.size,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      this.#readbackBufferCount++;
    }

    commandEncoder.resolveQuerySet(this.timestampQuerySet, 0, this.#nextQueryIndex, this.timestampResolveBuffer, 0);
    commandEncoder.copyBufferToBuffer(this.timestampResolveBuffer, 0, this.#currentReadbackBuffer, 0, this.timestampResolveBuffer.size);
  }

  async read() {
    if (!this.#currentReadbackBuffer) { return; }

    let readbackBuffer = this.#currentReadbackBuffer;
    let queries = { ...this.#queriesUsed.entries() };

    this.#currentReadbackBuffer = null;
    this.#queriesUsed.clear();

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const mappedArray = new BigUint64Array(readbackBuffer.getMappedRange());

    const results = {};
    let total = 0;
    for (const [ name, queries ] of Object.entries(queries)) {
      const passTime = Number(mappedArray[queries.end] - mappedArray[queries.begin]);
      // Discard negative times
      if (passTime >= 0) {
        let passTimings = this.#passTimings.get(name);
        if (!passTimings) {
          passTimings = {
            values: new Array(AVG_SAMPLE_COUNT),
            index: 0,
            average: 
          };
          this.#passTimings.set(name, passTimings);
        }
        // TODO: Storing pass timings in MS, maybe need higher resolution?
        let passTimeMs = passTime / 1000000;
        passTimings.values[passTimings.index++ % AVG_SAMPLE_COUNT] = passTimeMs;
        if (passTimings.index % AVG_SAMPLE_COUNT == 0) {
          // Update the average
          let avg = 0;
          for (const value of passTimings.values) {
            avg += value;
          }
          passTimings.average = avg / AVG_SAMPLE_COUNT;
        }
        results[name] = passTimeMs;
        total += passTimeMs;
      }
    }
    results.TOTAL = total;

    readbackBuffer.unmap();
    this.timestampReadbackBuffers.push(readbackBuffer);

    return results;
  }

  get averageTimings() {
    const results = {};
    let total = 0;
    for (const [name, timing] of this.#passTimings.entries()) {
      results[name] = timing.average;
      total += timing.average;
    }
    results.TOTAL = total;
    return results;
  }
}