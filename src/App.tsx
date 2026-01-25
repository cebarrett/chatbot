import { useState } from 'react'
import {
  Container,
  Typography,
  Button,
  Box,
  Card,
  CardContent,
  Stack,
  Link,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'

function App() {
  const [count, setCount] = useState(0)

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          py: 4,
        }}
      >
        <Stack direction="row" spacing={4} sx={{ mb: 4 }}>
          <Link href="https://vite.dev" target="_blank" rel="noopener">
            <Box
              component="img"
              src={viteLogo}
              alt="Vite logo"
              sx={{
                height: 96,
                transition: 'filter 0.3s',
                '&:hover': { filter: 'drop-shadow(0 0 2em #646cffaa)' },
              }}
            />
          </Link>
          <Link href="https://react.dev" target="_blank" rel="noopener">
            <Box
              component="img"
              src={reactLogo}
              alt="React logo"
              sx={{
                height: 96,
                transition: 'filter 0.3s',
                '&:hover': { filter: 'drop-shadow(0 0 2em #61dafbaa)' },
              }}
            />
          </Link>
        </Stack>

        <Typography variant="h3" component="h1" gutterBottom>
          Vite + React
        </Typography>

        <Card sx={{ mb: 3, width: '100%' }}>
          <CardContent sx={{ textAlign: 'center' }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AddIcon />}
              onClick={() => setCount((count) => count + 1)}
              sx={{ mb: 2 }}
            >
              Count is {count}
            </Button>
            <Typography variant="body2" color="text.secondary">
              Edit <code>src/App.tsx</code> and save to test HMR
            </Typography>
          </CardContent>
        </Card>

        <Typography variant="body2" color="text.secondary">
          Click on the Vite and React logos to learn more
        </Typography>
      </Box>
    </Container>
  )
}

export default App
