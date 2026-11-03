class Greeter {
  String greet(String name) => 'Hello, $name';
}

void main() {
  print(Greeter().greet('world'));
}
