# Writing Style - Reference Examples

Excerpts from Anilcan's published writing demonstrating voice patterns.

## Opening Examples

### Pattern: Series Introduction

```
Today, I'm starting a story series about design patterns in Flutter (or dart)
after a long time break. You can see much easier ways to do something when
you make progress on coding. And design patterns are general repeatable
solution standards for object-oriented programming.

My first selected pattern is a singleton cause it's simple and it's the
most used one (It's my idea).
```

### Pattern: Tutorial Introduction

```
Today, I'll give some examples for creating forms in flutter. If you don't
know Flutter, you can start in here. The Flutter is a mobile SDK for creating
mobile applications by fast.
```

### Pattern: Problem-Driven Introduction

```
Sometimes, we should use to virtual columns on storing some data in database.
This is good solution for my url shortener project because the shorting url
should be tiny and 62 base.
```

---

## Real-World Analogy Example

```
The government is an excellent example of the Singleton pattern. A country
can have only one official government. Regardless of the personal identities
of the individuals who form governments, the title, "The Government of X",
is a global point of access that identifies the group of people in charge.
```

## Rhetorical Question Patterns

### Introducing a Problem

```
But, If you want to change your home in some reasons on booting your app,
how can do this?
```

### Explaining Necessity

```
Why? Because, which method you using for auth system, it should have a
asynchrony function for first checking.
```

### Listing Requirements

```
Think a basic auth functions, so what are these? Login and logout
(Register can be optional if you uses Firebase).
```

## Step-by-Step Progression

```
Let's start writing from our auth service class. I said we have two methods
which are login and logout in this class and I'll use randomize response
for the login method because you know, this function should be true or
false in the real world.

[CODE BLOCK]

Next, create my pages. I said, I have two pages in this example.

[CODE BLOCK]

Yes, we have page and service classes for app. So, the time to run app.
```

## Code Demonstration Flow

```
Let's look my code in this step.

[CODE BLOCK]

Let's give it a shot.

[SCREENSHOT]

Now, we are ready to add a form in this page. Let's create a Form but
be careful because we need a key for this Form because we will use this
widget state in our class.
```

---

## Closing Examples

### Simple Closing

```
That's all.
```

## Inline Explanation Style

```dart
new TextFormField(
  keyboardType: TextInputType.emailAddress, // Use email input type for emails.
  decoration: new InputDecoration(
    hintText: 'you@example.com',
    labelText: 'E-mail Address',
  ),
),
new TextFormField(
  obscureText: true, // Use secure text for passwords.
),
```

## Topic Listing Pattern

```
The topics

- Creating a Flutter project
- Adding a package in your Flutter project
- Using a package in your Flutter project
- Defining routes in your Flutter project
- Navigating routes in your Flutter project

Let's start by creating a Flutter project.
```

## Prerequisite Handling

```
First of all, if you are new in Flutter, you can look my old post for
starting and creating a new Flutter project. I'll not show to create a
new Flutter project in this post.
```

## Explaining Technical Decisions

```
I choose json because a lot of translation tool support this file type.
So, I can use this sentences easily in translation tools.
```

```
I'm using the trigger function for auto generating because my project
can enter special keys to url.
```
