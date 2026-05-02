'use client'

import { useCallback, useRef, useState } from 'react'
import { CarFront, FileUp, FolderOpen } from 'lucide-react'

/**
 * Recursively reads all files from a dropped directory entry.
 * @param {FileSystemDirectoryEntry} dirEntry
 * @param {string} basePath
 * @returns {Promise<{ path: string, file: File }[]>}
 */
async function readDirectoryEntries(dirEntry, basePath = '') {
  const reader = dirEntry.createReader()
  const results = []

  // readEntries returns batches — must call repeatedly until empty
  const readBatch = () =>
    new Promise((resolve, reject) => reader.readEntries(resolve, reject))

  let batch
  do {
    batch = await readBatch()
    for (const entry of batch) {
      const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej))
        results.push({ path: entryPath, file })
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntries(entry, entryPath)
        results.push(...subFiles)
      }
    }
  } while (batch.length > 0)

  return results
}

/**
 * Collects all files from a DataTransfer (handles both files and folders).
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<{ path: string, file: File }[]>}
 */
async function collectDroppedFiles(dataTransfer) {
  const items = dataTransfer.items
  const results = []

  // Try webkitGetAsEntry first for folder support
  const entries = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }

  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej))
        results.push({ path: file.name, file })
      } else if (entry.isDirectory) {
        const subFiles = await readDirectoryEntries(entry)
        results.push(...subFiles)
      }
    }
    return results
  }

  // Fallback: plain files from dataTransfer.files
  for (const file of dataTransfer.files) {
    results.push({ path: file.name, file })
  }
  return results
}

/**
 * Drag-and-drop model upload zone.
 * Supports: single .glb, single .gltf, folder drop (.gltf + .bin + textures/),
 * or multi-file selection.
 *
 * @param {{ onFilesReady: (files: { path: string, file: File }[]) => void, disabled?: boolean }} props
 */
export default function ModelUploader({ onFilesReady, disabled = false }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef(null)
  const folderInputRef = useRef(null)

  const handleFiles = useCallback(
    async (fileList) => {
      if (disabled) return

      // If it's a pre-built array of { path, file }, use directly
      if (Array.isArray(fileList)) {
        if (fileList.length > 0) onFilesReady(fileList)
        return
      }

      // Single File or FileList
      const arr = []
      const files = fileList instanceof FileList ? fileList : [fileList]
      for (const f of files) {
        if (f) arr.push({ path: f.webkitRelativePath || f.name, file: f })
      }
      if (arr.length > 0) onFilesReady(arr)
    },
    [disabled, onFilesReady],
  )

  const onDrop = useCallback(
    async (e) => {
      e.preventDefault()
      setDragging(false)
      if (disabled) return
      const collected = await collectDroppedFiles(e.dataTransfer)
      handleFiles(collected)
    },
    [disabled, handleFiles],
  )

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])
  const onDragLeave = useCallback(() => setDragging(false), [])

  const onClickFile = useCallback(() => inputRef.current?.click(), [])
  const onClickFolder = useCallback(() => folderInputRef.current?.click(), [])

  const onInputChange = useCallback(
    (e) => handleFiles(e.target.files),
    [handleFiles],
  )

  return (
    <div className='az-upload-zone'>
      <div
        className={`az-upload-card ${dragging ? 'az-upload-card--drag' : ''}`}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClickFile}
        role='button'
        tabIndex={0}
        aria-label='Upload 3D model'
      >
        <div className='az-upload-icon'>
          <CarFront size={34} strokeWidth={1.8} aria-hidden='true' />
        </div>
        <div className='az-upload-title'>Drop your car model here</div>
        <div className='az-upload-sub'>
          Single <strong>.glb</strong> file, or drop an entire
          <strong> GLTF folder</strong> (.gltf + .bin + textures)
        </div>
        <div className='az-upload-formats'>
          <span className='az-upload-format-tag'>.GLB</span>
          <span className='az-upload-format-tag'>.GLTF</span>
          <span className='az-upload-format-tag'>FOLDER</span>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            className='az-btn'
            onClick={(e) => { e.stopPropagation(); onClickFile() }}
            type='button'
          >
            <FileUp size={14} strokeWidth={2.2} aria-hidden='true' />
            <span>Browse File</span>
          </button>
          <button
            className='az-btn'
            onClick={(e) => { e.stopPropagation(); onClickFolder() }}
            type='button'
          >
            <FolderOpen size={14} strokeWidth={2.2} aria-hidden='true' />
            <span>Browse Folder</span>
          </button>
        </div>

        {/* Single file input */}
        <input
          ref={inputRef}
          type='file'
          accept='.glb,.gltf,.bin'
          onChange={onInputChange}
          className='hidden'
          aria-hidden='true'
        />
        {/* Folder input */}
        <input
          ref={folderInputRef}
          type='file'
          onChange={onInputChange}
          className='hidden'
          aria-hidden='true'
          {...{ webkitdirectory: '', directory: '', mozdirectory: '' }}
        />
      </div>
    </div>
  )
}
