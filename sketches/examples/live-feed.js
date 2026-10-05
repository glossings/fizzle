// Text from somewhere else. Wikimedia publishes every page created across all
// its wikis as an event stream — a few a second, all day — and feed()
// subscribes to it. pick names the field holding the string, and fit sizes the
// type to the frame, so a three-letter title comes out huge and a long one
// comes out small.
resolution(1280, 720)

const pages = feed('https://stream.wikimedia.org/v2/stream/page-create', { pick: 'page_title' })

// the namespace the title carries, if it has one — File:, Category:, Talk:
const namespace = (s) => {
  const i = s.indexOf(':')
  return i < 0 ? [] : [[0, i + 1]]
}

// underscores out: a title is stored with them, and swapping them for spaces
// keeps the length, so the marks still land on the same characters
const title = (t) => pages.text(t).split('_').join(' ') || 'waiting for an edit'

const page = text({
  text: title,
  ranges: (t) => namespace(title(t)),
  fit: [0.88, 0.45],
  color: '#e8e4dc',
  bg: null,
  mark: { mode: 'fill', color: '#ffd84f', on: '#101014', pad: 0.12 },
})

constant('#0b0b10')
  .comp(ramp({ type: 'radial', a: '#19132e', b: '#0b0b10' }), 'screen')
  .comp(page, 'over')
  .out()
