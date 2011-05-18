all:  routes-min.js

routes-min.js:  routes.js
	uglifyJs $^ > $@

clean:
	rm routes-min.js 
