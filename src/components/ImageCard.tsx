import { useState } from 'react'
import { Box, Typography, IconButton, Skeleton } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import BrokenImageIcon from '@mui/icons-material/BrokenImage'
import type { ContentBlock } from '../types'

interface ImageCardProps {
  block: ContentBlock
  onClick: () => void
  fill?: boolean // true = cover the grid cell, false = natural aspect ratio
}

function downloadImage(block: ContentBlock) {
  if (!block.imageUrl) return
  const link = document.createElement('a')
  link.href = block.imageUrl
  link.download = block.alt || 'generated-image'
  link.target = '_blank'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function ImageCard({ block, onClick, fill }: ImageCardProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        borderRadius: 1,
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: 'action.hover',
        ...(fill
          ? { aspectRatio: '1', '& img': { objectFit: 'cover' } }
          : {}),
        '&:hover .image-overlay': { opacity: 1 },
      }}
    >
      {!loaded && !error && (
        <Skeleton variant="rectangular" width="100%" height={fill ? '100%' : 256} />
      )}
      {error ? (
        <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary' }}>
          <BrokenImageIcon />
          <Typography variant="caption" display="block">Failed to load image</Typography>
        </Box>
      ) : (
        <img
          src={block.imageUrl}
          alt={block.alt || 'Generated image'}
          style={{
            width: '100%',
            height: fill ? '100%' : 'auto',
            display: loaded ? 'block' : 'none',
            borderRadius: 4,
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
      {/* Hover overlay with download button */}
      <Box
        className="image-overlay"
        sx={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          p: 0.5,
          opacity: 0,
          transition: 'opacity 0.2s',
        }}
      >
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); downloadImage(block) }}
          sx={{
            bgcolor: 'rgba(0,0,0,0.5)',
            color: 'white',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.7)' },
          }}
        >
          <DownloadIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}
