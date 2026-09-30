// A5 keeps chapters comfortable to read on phones and tablets.
#let book-title = [$title$]
#set document(title: book-title)
#set page(paper: "a5", margin: (x: 16mm, y: 18mm), numbering: "1",
  header: align(right, text(size: 8pt, fill: luma(45%))[#book-title]))
#set text(font: "Libertinus Serif", size: 11pt, lang: "en")
#set par(justify: true, leading: 0.7em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(0.5em)
  text(size: 20pt, weight: "bold", it)
  v(0.8em)
}
#show math.equation: set text(size: 11pt)
#set table(inset: 5pt, stroke: 0.3pt + luma(75%))
#let horizontalRule = line(length: 100%, stroke: 0.4pt + luma(75%))
#let book-callout(label, body) = block(width: 100%, inset: 10pt,
  fill: rgb("f3f5f7"), stroke: (left: 2pt + rgb("52748c")), radius: 3pt,
  above: 0.8em, below: 0.8em)[
  // The label sticks to the first block of the body, so a callout never starts with an orphaned
  // header at the bottom of a page. The box itself may still break across pages.
  #block(sticky: true, above: 0pt, below: 0.4em)[#text(weight: "bold", size: 10pt)[#label]]
  #body
]
$if(highlighting-definitions)$
$highlighting-definitions$
$endif$
#align(center)[
  #v(20%)
  #text(size: 28pt, weight: "bold")[#book-title]
  #v(2em)
  $if(goal)$$goal$$endif$
  #v(2em)
  #text(size: 10pt)[$date$]
]
#pagebreak()
#outline(title: [Contents], depth: 2)
#pagebreak()
$body$
