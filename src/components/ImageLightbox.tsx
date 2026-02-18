import { useState, useEffect, useCallback } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos'
import DownloadIcon from '@mui/icons-material/Download'
import type { ContentBlock } from '../types'

interface ImageLightboxProps {
  images: ContentBlock[]
  startIndex: number
  onClose: () => void
}

export function ImageLightbox({ images, startIndex, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(startIndex)
  const hasMultiple = images.length > 1
  const current = images[index]

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % images.length)
  }, [images.length])

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length)
  }, [images.length])

  const handleDownload = useCallback(() => {
    if (!current?.imageUrl) return
    const link = document.createElement('a')
    link.href = current.imageUrl
    link.download = current.alt || 'generated-image'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [current])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          if (hasMultiple) goPrev()
          break
        case 'ArrowRight':
          if (hasMultiple) goNext()
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, hasMultiple, goNext, goPrev])

  return (
    <Box
      onClick={onClose}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Top bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 1,
          zIndex: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {hasMultiple && (
            <Typography variant="body2" sx={{ color: 'white', ml: 1 }}>
              {index + 1} / {images.length}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton onClick={(e) => { e.stopPropagation(); handleDownload() }} sx={{ color: 'white' }}>
            <DownloadIcon />
          </IconButton>
          <IconButton onClick={onClose} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Navigation arrows */}
      {hasMultiple && (
        <>
          <IconButton
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            sx={{
              position: 'absolute',
              left: 8,
              color: 'white',
              bgcolor: 'rgba(0,0,0,0.3)',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' },
            }}
          >
            <ArrowBackIosNewIcon />
          </IconButton>
          <IconButton
            onClick={(e) => { e.stopPropagation(); goNext() }}
            sx={{
              position: 'absolute',
              right: 8,
              color: 'white',
              bgcolor: 'rgba(0,0,0,0.3)',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.5)' },
            }}
          >
            <ArrowForwardIosIcon />
          </IconButton>
        </>
      )}

      {/* Image */}
      <img
        src={current?.imageUrl}
        alt={current?.alt || 'Generated image'}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '90vh',
          objectFit: 'contain',
          borderRadius: 4,
        }}
      />
    </Box>
  )
}
