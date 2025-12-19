import * as https from 'https';

const remoteCssCache = new Map<string, string>();

export async function fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`Status Code: ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', e => reject(e));
    });
}

export async function fetchUrlCached(url: string): Promise<string> {
    if (remoteCssCache.has(url)) return remoteCssCache.get(url)!;
    const content = await fetchUrl(url);
    remoteCssCache.set(url, content);
    return content;
}
/*
 private static fetchUrl(url: string): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get(url, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Status Code: ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', (e) => reject(e));
        });
    }

       private static async fetchUrlCached(url: string): Promise<string> {
        // Cache’de varsa direkt döndür
        if (this.remoteCssCache.has(url)) return this.remoteCssCache.get(url)!;

        // Yoksa fetch yap
        const content = await this.fetchUrl(url);

        // Cache’e ekle
        this.remoteCssCache.set(url, content);

        return content;
    }

*/