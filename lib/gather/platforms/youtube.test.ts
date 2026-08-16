import { describe, it, expect } from 'vitest'
import { parseTranscriptItems, idFromWatchUrl } from './youtube'
import type { RawItem } from '../types'

// Trimmed from the live bake-off run of scrape-creators~best-youtube-transcripts-scraper
// (2026-08-16, 10 Össur-corpus videos): first 3 segments per item, the two
// caption-less items verbatim. If the actor renames a field, this is where it shows.
const LIVE_ITEMS: RawItem[] = [
  {
    "id": "djWrNVWwz78",
    "url": "https://www.youtube.com/watch?v=djWrNVWwz78",
    "transcript_only_text": " Bionic  prosthetic  devices  enable  us  to \n restore  lust  function  in  ways  not \n possible  with  mechanical  pros",
    "transcript": [
      {
        "text": "Bionic prosthetic devices enable us to",
        "startMs": "1600",
        "endMs": "6319",
        "startTimeText": "0:01"
      },
      {
        "text": "restore lust function in ways not",
        "startMs": "4160",
        "endMs": "8800",
        "startTimeText": "0:04"
      },
      {
        "text": "possible with mechanical prosthetics.",
        "startMs": "6319",
        "endMs": "11360",
        "startTimeText": "0:06"
      }
    ],
    "language": "English"
  },
  {
    "id": "35Szn-2xZD0",
    "url": "https://www.youtube.com/watch?v=35Szn-2xZD0",
    "transcript_only_text": " Hello  everyone.  My  name  is  Rebecca \n Ligon,  and  I'm  really  excited  for \n [music]  you  to  discover  the  C-L",
    "transcript": [
      {
        "text": "Hello everyone. My name is Rebecca",
        "startMs": "0",
        "endMs": "3940",
        "startTimeText": "0:00"
      },
      {
        "text": "Ligon, and I'm really excited for",
        "startMs": "2040",
        "endMs": "5720",
        "startTimeText": "0:02"
      },
      {
        "text": "[music] you to discover the C-Leg.",
        "startMs": "3940",
        "endMs": "7400",
        "startTimeText": "0:03"
      }
    ],
    "language": "English"
  },
  {
    "id": "G6SvfIROSLQ",
    "url": "https://www.youtube.com/watch?v=G6SvfIROSLQ",
    "transcript_only_text": " La  fama,  mala  fama.  [música]  Se  la  pas \n diciendo  que  soy  mala  porque  no  me \n aguanto  drama  de  nada.  S",
    "transcript": [
      {
        "text": "La fama, mala fama. [música] Se la pas",
        "startMs": "199",
        "endMs": "4000",
        "startTimeText": "0:00"
      },
      {
        "text": "diciendo que soy mala porque no me",
        "startMs": "2159",
        "endMs": "5899",
        "startTimeText": "0:02"
      },
      {
        "text": "aguanto drama de nada. Si vienes",
        "startMs": "4000",
        "endMs": "6560",
        "startTimeText": "0:04"
      }
    ],
    "language": "Spanish"
  },
  {
    "id": "4nylf9HyC0E",
    "url": "https://www.youtube.com/watch?v=4nylf9HyC0E",
    "transcript_only_text": " [music] \n [music] \n [music] \n [music] \n [music] \n [music] \n >> Mhm.",
    "transcript": [
      {
        "text": "[music]",
        "startMs": "5239",
        "endMs": "7259",
        "startTimeText": "0:05"
      },
      {
        "text": "[music]",
        "startMs": "17685",
        "endMs": "19705",
        "startTimeText": "0:17"
      },
      {
        "text": "[music]",
        "startMs": "24235",
        "endMs": "26255",
        "startTimeText": "0:24"
      }
    ],
    "language": "English"
  },
  {
    "id": "2zKugzmPhTo",
    "url": "https://www.youtube.com/watch?v=2zKugzmPhTo",
    "transcript_only_text": null,
    "transcript": null,
    "language": null
  },
  {
    "id": "Lt0OzJ9iP8M",
    "url": "https://www.youtube.com/watch?v=Lt0OzJ9iP8M",
    "transcript_only_text": null,
    "transcript": null,
    "language": null
  },
  {
    "id": "6AIKt-xbXLA",
    "url": "https://www.youtube.com/watch?v=6AIKt-xbXLA",
    "transcript_only_text": " [music] \n [music] \n [music] \n [music] \n [music] \n >> Hey.",
    "transcript": [
      {
        "text": "[music]",
        "startMs": "1964",
        "endMs": "3984",
        "startTimeText": "0:01"
      },
      {
        "text": "[music]",
        "startMs": "7205",
        "endMs": "9225",
        "startTimeText": "0:07"
      },
      {
        "text": "[music]",
        "startMs": "13100",
        "endMs": "15120",
        "startTimeText": "0:13"
      }
    ],
    "language": "English"
  },
  {
    "id": "QUmDw1uiVQM",
    "url": "https://www.youtube.com/watch?v=QUmDw1uiVQM",
    "transcript_only_text": " Do  you  something  cool.  Autobock  C-leg  X4 \n has  the  technology  of  uphill  walking.  So \n your  knee  will  ben",
    "transcript": [
      {
        "text": "Do you something cool. Autobock C-leg X4",
        "startMs": "0",
        "endMs": "4280",
        "startTimeText": "0:00"
      },
      {
        "text": "has the technology of uphill walking. So",
        "startMs": "1960",
        "endMs": "5880",
        "startTimeText": "0:01"
      },
      {
        "text": "your knee will bend as you walk up a",
        "startMs": "4280",
        "endMs": "7080",
        "startTimeText": "0:04"
      }
    ],
    "language": "English"
  },
  {
    "id": "_1FNhJTm0o4",
    "url": "https://www.youtube.com/watch?v=_1FNhJTm0o4",
    "transcript_only_text": " Hi, I'm I'm Susan Mala. I'm with the\nAuto Bock company for 5 years and I'm the coach for the Exopulse suit. And\nactuall",
    "transcript": [
      {
        "text": "Hi, I'm I'm Susan Mala. I'm with theAuto Bock company for 5 years and I'm",
        "startMs": "0",
        "endMs": "7480",
        "startTimeText": "0:00"
      },
      {
        "text": "the coach for the Exopulse suit. Andactually, I'm on the OT World and",
        "startMs": "4920",
        "endMs": "12800",
        "startTimeText": "0:04"
      },
      {
        "text": "so many persons ask for the Exopulse,what is it? And our Exopulse suit is a",
        "startMs": "10320",
        "endMs": "19280",
        "startTimeText": "0:10"
      }
    ],
    "language": "English"
  },
  {
    "id": "xphlrp099n0",
    "url": "https://www.youtube.com/watch?v=xphlrp099n0",
    "transcript_only_text": " Hey  zusammen  und  willkommen  zu  dieser \n neuen  Analyse.  Heute  nehmen  wir  uns  ein \n Unternehmen  vor,  das  im",
    "transcript": [
      {
        "text": "Hey zusammen und willkommen zu dieser",
        "startMs": "40",
        "endMs": "5160",
        "startTimeText": "0:00"
      },
      {
        "text": "neuen Analyse. Heute nehmen wir uns ein",
        "startMs": "2320",
        "endMs": "6799",
        "startTimeText": "0:02"
      },
      {
        "text": "Unternehmen vor, das im Moment ein",
        "startMs": "5160",
        "endMs": "9240",
        "startTimeText": "0:05"
      }
    ],
    "language": "German"
  }
]

describe('youtube.parseTranscriptItems — field paths pinned to the live actor', () => {
  const parsed = parseTranscriptItems(LIVE_ITEMS)

  it('keeps every item keyed by video id (10 in, 10 out)', () => {
    expect(parsed.size).toBe(10)
    expect([...parsed.keys()]).toEqual(LIVE_ITEMS.map((i) => i.id))
  })

  it('rebuilds text from the segments with single spaces (not the double-spaced flat field)', () => {
    const ossur = parsed.get('djWrNVWwz78')!
    expect(ossur.text).toBe('Bionic prosthetic devices enable us to restore lust function in ways not possible with mechanical prosthetics.')
    expect(ossur.text).not.toMatch(/  /)
  })

  it('maps a caption-less item (all fields null) to null, not to an empty transcript', () => {
    expect(parsed.get('2zKugzmPhTo')).toBeNull()
    expect(parsed.get('Lt0OzJ9iP8M')).toBeNull()
  })

  it('passes the language name through untouched for the caller to normalise', () => {
    expect(parsed.get('G6SvfIROSLQ')!.lang).toBe('Spanish')
    expect(parsed.get('xphlrp099n0')!.lang).toBe('German')
    expect(parsed.get('djWrNVWwz78')!.lang).toBe('English')
  })

  it('falls back to the flat text when segments are missing, and to the url when id is missing', () => {
    const odd = parseTranscriptItems([
      { url: 'https://www.youtube.com/watch?v=abc123DEF45', transcript_only_text: ' hello   world ', transcript: null, language: null },
    ])
    expect(odd.get('abc123DEF45')).toEqual({ text: 'hello world', lang: null, source: 'youtube_caption' })
  })

  it('drops an item with neither id nor a parseable url', () => {
    expect(parseTranscriptItems([{ url: 'not a url', transcript_only_text: 'x' }]).size).toBe(0)
  })
})

describe('idFromWatchUrl', () => {
  it('reads the v= param and returns empty for anything else', () => {
    expect(idFromWatchUrl('https://www.youtube.com/watch?v=djWrNVWwz78&t=3s')).toBe('djWrNVWwz78')
    expect(idFromWatchUrl('https://youtu.be/djWrNVWwz78')).toBe('')
    expect(idFromWatchUrl('')).toBe('')
  })
})
