package main

import "fmt"

type Greeter struct{}

func (Greeter) Greet(name string) string {
	return "Hello, " + name
}

func main() {
	fmt.Println(Greeter{}.Greet("world"))
}
