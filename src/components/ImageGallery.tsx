import { useState } from 'react'
import { Box } from '@mui/material'
import { ImageCard } from './ImageCard'
import { ImageLightbox } from './ImageLightbox'
import type { ContentBlock } from '../types'

interface ImageGalleryProps {
  images: ContentBlock[]
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  if (images.length === 0) return null

  // Single image - simple display
  if (images.length === 1) {
    return (
      <Box sx={{ my: 2, maxWidth: 512 }}>
        <ImageCard
          block={images[0]}
          onClick={() => setLightboxIndex(0)}
        />
        {lightboxIndex !== null && (
          <ImageLightbox
            images={images}
            startIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </Box>
    )
  }

  // Multiple images - responsive grid
  return (
    <Box sx={{ my: 2, maxWidth: 600 }}>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 1,
        // For 3 images: first image spans both rows on the left
        ...(images.length === 3 && {
          gridTemplateRows: 'repeat(2, 1fr)',
          '& > :first-of-type': {
            gridRow: '1 / 3',
          },
        }),
      }}>
        {images.map((img, i) => (
          <ImageCard
            key={i}
            block={img}
            onClick={() => setLightboxIndex(i)}
            fill={images.length > 1}
          />
        ))}
      </Box>
      {lightboxIndex !== null && (
        <ImageLightbox
          images={images}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </Box>
  )
}
