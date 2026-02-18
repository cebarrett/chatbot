import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  MobileStepper,
  useTheme,
  useMediaQuery,
} from '@mui/material'
import PsychologyIcon from '@mui/icons-material/Psychology'
import TuneIcon from '@mui/icons-material/Tune'
import RateReviewIcon from '@mui/icons-material/RateReview'
import QuestionAnswerIcon from '@mui/icons-material/QuestionAnswer'
import PersonIcon from '@mui/icons-material/Person'
import KeyboardArrowLeft from '@mui/icons-material/KeyboardArrowLeft'
import KeyboardArrowRight from '@mui/icons-material/KeyboardArrowRight'

interface OnboardingStep {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}

const steps: OnboardingStep[] = [
  {
    icon: <PsychologyIcon sx={{ fontSize: 48 }} />,
    title: 'AI is useful, but not perfect',
    body: (
      <>
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          AI chatbots can be confidently wrong, make things up, or give
          different answers depending on the day.
        </Typography>
        <Typography variant="body1">
          This app is designed to help you see that for yourself — so you can
          use AI productively without being misled by it.
        </Typography>
      </>
    ),
  },
  {
    icon: <TuneIcon sx={{ fontSize: 48 }} />,
    title: 'Choose your AI',
    body: (
      <>
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          Use the provider selector in the toolbar to switch between different
          AI systems — each with different strengths and blind spots.
        </Typography>
        <Typography variant="body1">
          Try asking the same question to different providers. You might be
          surprised how much the answers vary.
        </Typography>
      </>
    ),
  },
  {
    icon: <RateReviewIcon sx={{ fontSize: 48 }} />,
    title: 'Every response gets a second opinion',
    body: (
      <>
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          Independent AI reviewers automatically evaluate each response and
          flag potential problems. It's like having a fact-checker built in.
        </Typography>
        <Typography variant="body1">
          Of course, the fact-checkers can be wrong too — that's part of the
          point.
        </Typography>
      </>
    ),
  },
  {
    icon: <QuestionAnswerIcon sx={{ fontSize: 48 }} />,
    title: 'Ask the reviewers why',
    body: (
      <>
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          Tap on any reviewer rating to see their full explanation, including
          specific problems they found.
        </Typography>
        <Typography variant="body1">
          You can also ask follow-up questions like "Is this really accurate?"
          or "What should I verify?"
        </Typography>
      </>
    ),
  },
  {
    icon: <PersonIcon sx={{ fontSize: 48 }} />,
    title: "You're the final judge",
    body: (
      <>
        <Typography variant="body1" sx={{ mb: 1.5 }}>
          The scores and evaluations are tools to help you think — not a stamp
          of approval.
        </Typography>
        <Typography variant="body1">
          Question everything, including the reviewers. The goal is to build
          your own instincts for when to trust AI and when to double-check.
        </Typography>
      </>
    ),
  },
]

interface OnboardingModalProps {
  open: boolean
  onComplete: () => void
}

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const [activeStep, setActiveStep] = useState(0)
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const maxSteps = steps.length
  const step = steps[activeStep]

  const handleNext = () => {
    if (activeStep === maxSteps - 1) {
      setActiveStep(0)
      onComplete()
    } else {
      setActiveStep((prev) => prev + 1)
    }
  }

  const handleBack = () => {
    setActiveStep((prev) => prev - 1)
  }

  const handleSkip = () => {
    setActiveStep(0)
    onComplete()
  }

  return (
    <Dialog
      open={open}
      onClose={handleSkip}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          maxHeight: '90dvh',
        },
      }}
    >
      <DialogTitle
        sx={{
          textAlign: 'center',
          pt: 3,
          pb: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            mb: 1.5,
            color: 'primary.main',
          }}
        >
          {step.icon}
        </Box>
        <Typography variant={isMobile ? 'h6' : 'h5'} component="span" fontWeight={600}>
          {step.title}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ px: { xs: 3, sm: 4 }, py: 2 }}>
        {step.body}
      </DialogContent>

      <Box sx={{ px: 2, pb: 1 }}>
        <MobileStepper
          variant="dots"
          steps={maxSteps}
          position="static"
          activeStep={activeStep}
          sx={{
            bgcolor: 'transparent',
            '& .MuiMobileStepper-dot': {
              mx: 0.5,
            },
          }}
          nextButton={<Box sx={{ width: 80 }} />}
          backButton={<Box sx={{ width: 80 }} />}
        />
      </Box>

      <DialogActions sx={{ px: 3, pb: 3, pt: 0, justifyContent: 'space-between' }}>
        {activeStep > 0 ? (
          <Button onClick={handleBack} startIcon={<KeyboardArrowLeft />}>
            Back
          </Button>
        ) : (
          <Button onClick={handleSkip} color="inherit" size="small">
            Skip
          </Button>
        )}
        <Button
          onClick={handleNext}
          variant="contained"
          endIcon={activeStep < maxSteps - 1 ? <KeyboardArrowRight /> : undefined}
        >
          {activeStep === maxSteps - 1 ? "Get started" : 'Next'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
