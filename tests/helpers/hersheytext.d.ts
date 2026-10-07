declare module 'hersheytext' {
  export interface HersheyGlyph {
    type: string;
    name: string;
    width: number;
    d: string;
  }
  export function renderTextArray(text: string, options?: { font?: string; scale?: number }): HersheyGlyph[];
}
