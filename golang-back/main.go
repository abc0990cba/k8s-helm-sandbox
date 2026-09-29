package main

import "log"

// https://go.dev/blog/laws-of-reflection
// https://habr.com/ru/companies/otus/articles/833770/
// https://tutorialedge.net/golang/validating-http-json-requests/
// https://reliasoftware.com/blog/reflection-in-golang
// https://www.ardanlabs.com/blog/2024/01/ultimate-go-tour.html

func main() {
	a := [...]string{"a", "b", "c", "d"}
	b := a[2:]

	log.Println(a) // [a b c d]
	log.Println(b) // [c d]

	b[1] = "e"

	log.Println(a) // [a b c e]
	log.Println(b) // [c e]
}
