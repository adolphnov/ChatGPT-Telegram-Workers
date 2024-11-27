import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { Readable } from 'node:stream';
import { Base64Encode } from 'base64-stream';
import ffmpeg from 'fluent-ffmpeg';

interface AudioConverter {
    convert: (target?: 'base64' | 'blob') => Promise<string | Blob>;
}

export abstract class BaseConverter implements AudioConverter {
    protected command: ffmpeg.FfmpegCommand;
    constructor() {
        this.command = ffmpeg();
    }

    abstract convert(target?: 'base64' | 'blob'): Promise<string | Blob>;

    // protected handleError(error: any): never {
    //     throw error;
    // }
}

class OggToMp3Converter extends BaseConverter {
    constructor(private data: Readable | WebReadableStream | string | Blob, private target: 'base64' | 'blob' = 'base64') {
        super();
    }

    private async prepareInput(): Promise<Readable> {
        if (this.data instanceof Readable) {
            return this.data;
        }
        if (typeof this.data === 'string') {
            return Readable.from(Buffer.from(this.data, 'base64'));
        }
        if (this.data instanceof Blob) {
            const arrayBuffer = await this.data.arrayBuffer();
            return Readable.from(Buffer.from(arrayBuffer));
        }
        return Readable.fromWeb(this.data);
    }

    async convert(): Promise<string | Blob> {
        const input = await this.prepareInput();
        return new Promise((resolve, reject) => {
            let base64Data = '';
            this.command
                .input(input)
                // .inputFormat('ogg')
                .audioCodec('libmp3lame')
                .audioBitrate('64k')
                // .audioChannels(1)
                // .audioFrequency(16000)
                .format('mp3')
                .on('error', err => reject(err))
                .pipe()
                .pipe(new Base64Encode())
                .on('data', (chunk: Buffer) => {
                    base64Data += chunk.toString();
                })
                .on('end', () => resolve(this.target === 'base64' ? base64Data : new Blob([Buffer.from(base64Data, 'base64')], { type: 'audio/mp3' })))
                .on('error', err => reject(err));
        });
    }
}

class Mp3ToOggConverter extends BaseConverter {
    constructor(private data: Readable | string, private target: 'base64' | 'blob' = 'blob') {
        super();
    }

    async convert(): Promise<string | Blob> {
        return new Promise((resolve, reject) => {
            // 创建输入流
            const inputStream = typeof this.data === 'string' ? Readable.from(Buffer.from(this.data, 'base64')) : this.data;

            const chunks: Buffer[] = [];

            this.command
                .input(inputStream)
                // .inputFormat('mp3')
                .audioCodec('libopus')
                .audioBitrate('32k')
                // .audioChannels(1)
                // .audioFrequency(16000)
                .format('ogg')
                .on('error', err => reject(err))
                .pipe()
                .on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                })
                .on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const blob = new Blob([buffer], { type: 'audio/ogg' });
                    resolve(this.target === 'base64' ? buffer.toString('base64') : blob);
                })
                .on('error', err => reject(err));
        });
    }
}

export { Mp3ToOggConverter, OggToMp3Converter };
