export class AsyncIter<T extends { done: boolean; content: any }> {
    private queue: T[] = [];
    private resolver: any[] = [];
    private done = false;

    get isDone() {
        return this.done;
    }

    add(item: T) {
        if (this.done) {
            throw new Error('Cannot add items to a completed iterator.');
        }
        if (item.done) {
            this.done = true;
        }

        if (this.resolver.length > 0) {
            const resolve = this.resolver.shift()!;
            resolve({ done: false, value: item.content });
            if (item.done && this.resolver.length > 0) {
                this.resolver.forEach(resolve => resolve({ done: true, value: undefined }));
                this.resolver = [];
                this.done = true;
            }
        } else {
            this.queue.push(item);
        }
    }

    next() {
        return new Promise((resolve) => {
            if (this.queue.length > 0) {
                const data = this.queue.shift()!;
                resolve({ done: false, value: data.content });
                if (data.done) {
                    this.done = true;
                }
                return;
            }
            if (this.done) {
                resolve({ done: true, value: undefined });
                return;
            }
            this.resolver.push(resolve);
        });
    }

    return() {
        if (!this.done) {
            this.done = true;
        }
        this.resolver.forEach(resolve => resolve({ done: true, value: undefined }));
        return Promise.resolve({ done: true, value: undefined });
    }

    [Symbol.asyncIterator]() {
        return this;
    }
}
