import { openDB, type IDBPDatabase } from 'idb';
import type { ExtractedPage } from './types';

const DB_NAME = 'readflow-db';
const DB_VERSION = 100;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is only available in the browser');
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
        if (!db.objectStoreNames.contains('pagesData')) db.createObjectStore('pagesData');
      },
    });
  }
  return dbPromise;
}

export async function saveFile(bookId: string, arrayBuffer: ArrayBuffer): Promise<void> {
  const db = await getDB();
  await db.put('files', arrayBuffer, bookId);
}

export async function getFile(bookId: string): Promise<ArrayBuffer | undefined> {
  const db = await getDB();
  return db.get('files', bookId);
}

export async function deleteFile(bookId: string): Promise<void> {
  const db = await getDB();
  await db.delete('files', bookId);
}

export async function savePagesData(bookId: string, pages: ExtractedPage[]): Promise<void> {
  const db = await getDB();
  await db.put('pagesData', pages, bookId);
}

export async function getPagesData(bookId: string): Promise<ExtractedPage[]> {
  const db = await getDB();
  return (await db.get('pagesData', bookId)) || [];
}

export async function deletePagesData(bookId: string): Promise<void> {
  const db = await getDB();
  await db.delete('pagesData', bookId);
}

export async function clearAllFiles(): Promise<void> {
  const db = await getDB();
  await db.clear('files');
  await db.clear('pagesData');
}
