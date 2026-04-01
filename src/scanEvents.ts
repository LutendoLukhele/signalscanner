import { EventEmitter } from 'events';

export interface ScanProgressEvent {
  type: 'progress';
  scraper: string;
  count: number;
}

export interface ScanDoneEvent {
  type: 'done';
  total: number;
}

export interface ScanErrorEvent {
  type: 'error';
  message: string;
}

export type ScanEvent = ScanProgressEvent | ScanDoneEvent | ScanErrorEvent;

/** Shared pub/sub bus — scheduler emits, SSE route broadcasts to clients */
export const scanBus = new EventEmitter();
scanBus.setMaxListeners(50); // allow many concurrent SSE subscribers
