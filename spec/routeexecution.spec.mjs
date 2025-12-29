/*
 * Testing the output of when routes are executed. 
 */
import routes from '../src/routes.js';

describe("routing", function() {
  var r;
  beforeEach(function() {
    r = new routes();
  });

  it("should fire on push state", function() {
    // This test is intentionally left empty as in the original
  });

  it("should fire on form submission", function() {
    var triggered = false;
    r.post("/test", function() {
      triggered = true;
    });
    var form = document.createElement("form");
    var submit = document.createElement("input");
    submit.type = "submit";
    form.action = "/test";
    form.method = "post";
    form.appendChild(submit);
     
    window.document.body.appendChild(form);
    
    submit.click();

    window.document.body.removeChild(form);

    expect(triggered).toEqual(true);
  }); 

});
